# Calibre Database Access Layer
# Adapted from Calibre-Web-Automated project
# Copyright (C) 2018-2025 Calibre-Web contributors
# Copyright (C) 2024-2025 Calibre-Web Automated contributors
# SPDX-License-Identifier: GPL-3.0-or-later

import os
import re
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any

from sqlite3 import OperationalError as sqliteOperationalError
from sqlalchemy import create_engine, MetaData, Table
from sqlalchemy.orm import sessionmaker, scoped_session
from sqlalchemy.exc import OperationalError
from sqlalchemy.pool import StaticPool
from sqlalchemy.sql.expression import and_, or_, func

# Import our environment settings
try:
    from env import CWA_DB_PATH
except ImportError:
    CWA_DB_PATH = None


class CalibreDB:
    """
    Calibre database access layer for reading Calibre's metadata.db
    """
    
    def __init__(self, library_path: Optional[str] = None):
        self.library_path = library_path or self._find_calibre_library()
        self.metadata_db_path = None
        self.engine = None
        self.session = None
        self.metadata = None
        
        if self.library_path:
            self.metadata_db_path = os.path.join(self.library_path, 'metadata.db')
            self._initialize_database()
    
    def _find_calibre_library(self) -> Optional[str]:
        """Find Calibre library directory"""
        # Check common locations
        possible_paths = [
            os.path.expanduser("~/Calibre Library"),
            os.path.expanduser("~/Documents/Calibre Library"),
            "./calibre-library",
            "/calibre-library"
        ]
        
        # If CWA_DB_PATH is set, look for library in parent directory
        if CWA_DB_PATH:
            parent_dir = CWA_DB_PATH.parent
            possible_paths.insert(0, str(parent_dir / "calibre-library"))
        
        for path in possible_paths:
            if os.path.exists(path) and os.path.exists(os.path.join(path, 'metadata.db')):
                return path
        
        return None
    
    def _initialize_database(self):
        """Initialize database connection"""
        if not self.metadata_db_path or not os.path.exists(self.metadata_db_path):
            return
        
        try:
            # Create SQLAlchemy engine
            self.engine = create_engine(
                f'sqlite:///{self.metadata_db_path}',
                poolclass=StaticPool,
                connect_args={
                    'check_same_thread': False,
                    'timeout': 20
                },
                echo=False
            )
            
            # Create session
            Session = scoped_session(sessionmaker(bind=self.engine))
            self.session = Session()
            
            # Reflect the database structure
            self.metadata = MetaData()
            self.metadata.reflect(bind=self.engine)
            
        except Exception as e:
            print(f"Error initializing Calibre database: {e}")
            self.engine = None
            self.session = None
    
    def is_available(self) -> bool:
        """Check if Calibre database is available"""
        return self.session is not None
    
    def get_books(self, limit: int = 25, offset: int = 0, sort_by: str = 'id', 
                  search_query: str = None) -> Dict[str, Any]:
        """Get books from Calibre library"""
        if not self.is_available():
            return {'books': [], 'total': 0}
        
        try:
            books_table = self.metadata.tables['books']
            authors_table = self.metadata.tables['authors']
            books_authors_link = self.metadata.tables['books_authors_link']
            
            # Build base query
            query = self.session.query(books_table).join(
                books_authors_link, books_table.c.id == books_authors_link.c.book
            ).join(
                authors_table, books_authors_link.c.author == authors_table.c.id
            )
            
            # Add search filter if provided
            if search_query:
                search_filter = or_(
                    books_table.c.title.contains(search_query),
                    authors_table.c.name.contains(search_query)
                )
                query = query.filter(search_filter)
            
            # Get total count
            total = query.count()
            
            # Add sorting
            if sort_by == 'title':
                query = query.order_by(books_table.c.title)
            elif sort_by == 'author':
                query = query.order_by(authors_table.c.name)
            elif sort_by == 'timestamp':
                query = query.order_by(books_table.c.timestamp.desc())
            else:
                query = query.order_by(books_table.c.id.desc())
            
            # Add pagination
            query = query.offset(offset).limit(limit)
            
            # Execute query
            results = query.all()
            
            # Format results
            books = []
            for row in results:
                book = {
                    'id': row.id,
                    'title': row.title,
                    'author': self._get_book_authors(row.id),
                    'timestamp': row.timestamp,
                    'path': row.path,
                    'has_cover': bool(row.has_cover),
                    'series': self._get_book_series(row.id),
                    'formats': self._get_book_formats(row.id)
                }
                books.append(book)
            
            return {
                'books': books,
                'total': total,
                'limit': limit,
                'offset': offset
            }
            
        except Exception as e:
            print(f"Error getting books: {e}")
            return {'books': [], 'total': 0}
    
    def get_book_by_id(self, book_id: int) -> Optional[Dict[str, Any]]:
        """Get a specific book by ID"""
        if not self.is_available():
            return None
        
        try:
            books_table = self.metadata.tables['books']
            result = self.session.query(books_table).filter(
                books_table.c.id == book_id
            ).first()
            
            if result:
                return {
                    'id': result.id,
                    'title': result.title,
                    'author': self._get_book_authors(result.id),
                    'timestamp': result.timestamp,
                    'path': result.path,
                    'has_cover': bool(result.has_cover),
                    'series': self._get_book_series(result.id),
                    'formats': self._get_book_formats(result.id),
                    'tags': self._get_book_tags(result.id),
                    'comments': self._get_book_comments(result.id),
                    'pubdate': result.pubdate,
                    'isbn': self._get_book_identifiers(result.id)
                }
            
        except Exception as e:
            print(f"Error getting book {book_id}: {e}")
        
        return None
    
    def search_books(self, query: str, limit: int = 25) -> List[Dict[str, Any]]:
        """Search books in library"""
        result = self.get_books(limit=limit, search_query=query)
        return result['books']
    
    def _get_book_authors(self, book_id: int) -> str:
        """Get authors for a book"""
        try:
            authors_table = self.metadata.tables['authors']
            books_authors_link = self.metadata.tables['books_authors_link']
            
            results = self.session.query(authors_table.c.name).join(
                books_authors_link, authors_table.c.id == books_authors_link.c.author
            ).filter(books_authors_link.c.book == book_id).all()
            
            return ', '.join([row.name for row in results])
        except:
            return 'Unknown'
    
    def _get_book_series(self, book_id: int) -> Optional[str]:
        """Get series for a book"""
        try:
            if 'books_series_link' in self.metadata.tables and 'series' in self.metadata.tables:
                series_table = self.metadata.tables['series']
                books_series_link = self.metadata.tables['books_series_link']
                
                result = self.session.query(series_table.c.name).join(
                    books_series_link, series_table.c.id == books_series_link.c.series
                ).filter(books_series_link.c.book == book_id).first()
                
                return result.name if result else None
        except:
            pass
        return None
    
    def _get_book_formats(self, book_id: int) -> List[str]:
        """Get available formats for a book"""
        try:
            if 'data' in self.metadata.tables:
                data_table = self.metadata.tables['data']
                results = self.session.query(data_table.c.format).filter(
                    data_table.c.book == book_id
                ).all()
                
                return [row.format.lower() for row in results]
        except:
            pass
        return []
    
    def _get_book_tags(self, book_id: int) -> List[str]:
        """Get tags for a book"""
        try:
            if 'books_tags_link' in self.metadata.tables and 'tags' in self.metadata.tables:
                tags_table = self.metadata.tables['tags']
                books_tags_link = self.metadata.tables['books_tags_link']
                
                results = self.session.query(tags_table.c.name).join(
                    books_tags_link, tags_table.c.id == books_tags_link.c.tag
                ).filter(books_tags_link.c.book == book_id).all()
                
                return [row.name for row in results]
        except:
            pass
        return []
    
    def _get_book_comments(self, book_id: int) -> Optional[str]:
        """Get comments/description for a book"""
        try:
            if 'comments' in self.metadata.tables:
                comments_table = self.metadata.tables['comments']
                result = self.session.query(comments_table.c.text).filter(
                    comments_table.c.book == book_id
                ).first()
                
                return result.text if result else None
        except:
            pass
        return None
    
    def _get_book_identifiers(self, book_id: int) -> Dict[str, str]:
        """Get identifiers (ISBN, etc.) for a book"""
        try:
            if 'identifiers' in self.metadata.tables:
                identifiers_table = self.metadata.tables['identifiers']
                results = self.session.query(
                    identifiers_table.c.type, identifiers_table.c.val
                ).filter(identifiers_table.c.book == book_id).all()
                
                return {row.type: row.val for row in results}
        except:
            pass
        return {}
    
    def get_book_file_path(self, book_id: int, format: str) -> Optional[str]:
        """Get file path for a specific book format"""
        try:
            if 'data' in self.metadata.tables:
                data_table = self.metadata.tables['data']
                books_table = self.metadata.tables['books']
                
                result = self.session.query(
                    data_table.c.name, books_table.c.path
                ).join(
                    books_table, data_table.c.book == books_table.c.id
                ).filter(
                    and_(data_table.c.book == book_id, 
                         data_table.c.format == format.upper())
                ).first()
                
                if result and self.library_path:
                    return os.path.join(self.library_path, result.path, f"{result.name}.{format.lower()}")
        except:
            pass
        return None
    
    def get_cover_path(self, book_id: int) -> Optional[str]:
        """Get cover image path for a book"""
        try:
            books_table = self.metadata.tables['books']
            result = self.session.query(books_table.c.path, books_table.c.has_cover).filter(
                books_table.c.id == book_id
            ).first()
            
            if result and result.has_cover and self.library_path:
                return os.path.join(self.library_path, result.path, 'cover.jpg')
        except:
            pass
        return None
    
    def close(self):
        """Close database connection"""
        if self.session:
            self.session.close()


# Global instance
calibre_db = CalibreDB()
