"""
Direct Calibre metadata.db access using CWA ORM models
"""
import os
from pathlib import Path
from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker, scoped_session
from sqlalchemy.pool import StaticPool
from typing import List, Dict, Any, Optional
import logging

# Import the proper CWA Calibre models
from calibre_models import Books, Authors, Series, Tags, Languages, Data, Comments, Ratings

logger = logging.getLogger(__name__)

class CalibreDBManager:
    def __init__(self, metadata_db_path: str):
        """Initialize connection to Calibre metadata.db"""
        self.db_path = Path(metadata_db_path)
        if not self.db_path.exists():
            raise FileNotFoundError(f"Metadata database not found: {metadata_db_path}")
        
        # Create SQLAlchemy engine for Calibre database
        self.engine = create_engine(
            f'sqlite:///{self.db_path}',
            poolclass=StaticPool,
            connect_args={'check_same_thread': False},
            echo=False  # Set to True for SQL debugging
        )
        
        # Create session factory
        self.Session = scoped_session(sessionmaker(bind=self.engine))
    
    def get_session(self):
        """Get a database session"""
        return self.Session()
    
    def close_session(self, session):
        """Close a database session"""
        session.close()
    
    def get_books(self, page: int = 1, per_page: int = 18, search: str = None, 
                  sort: str = 'new') -> Dict[str, Any]:
        """Get books from Calibre library with pagination"""
        session = self.get_session()
        try:
            # Base query with joins for related data
            query = session.query(Books).join(Authors, Books.authors).outerjoin(Series, Books.series)
            
            # Apply search filter if provided
            if search:
                search_term = f"%{search}%"
                query = query.filter(
                    Books.title.like(search_term) |
                    Authors.name.like(search_term) |
                    Series.name.like(search_term)
                )
            
            # Apply sorting
            if sort == 'new':
                query = query.order_by(Books.timestamp.desc())
            elif sort == 'old':
                query = query.order_by(Books.timestamp.asc())
            elif sort == 'abc':
                query = query.order_by(Books.sort.asc())
            elif sort == 'zyx':
                query = query.order_by(Books.sort.desc())
            elif sort == 'author':
                query = query.order_by(Authors.sort.asc())
            else:
                query = query.order_by(Books.timestamp.desc())
            
            # Get total count before pagination
            total_count = query.count()
            
            # Apply pagination
            offset = (page - 1) * per_page
            books = query.offset(offset).limit(per_page).all()
            
            # Transform to API format
            books_data = []
            for book in books:
                # Get all authors for this book
                authors = [author.name for author in book.authors]
                
                # Get tags for this book
                tags = [tag.name for tag in book.tags]
                
                # Get languages for this book
                languages = [lang.lang_code for lang in book.languages]
                
                # Get available formats
                formats = [data.format.upper() for data in book.data]
                
                # Get rating (from ratings relationship)
                rating = None
                if book.ratings:
                    rating = book.ratings[0].rating / 2  # Convert from 0-10 to 0-5
                
                # Check if book has cover
                has_cover = os.path.exists(os.path.join(self.db_path.parent, book.path, 'cover.jpg'))
                
                book_data = {
                    'id': book.id,
                    'title': book.title,
                    'authors': authors,
                    'series': book.series[0].name if book.series else None,
                    'series_index': float(book.series_index) if book.series_index else None,
                    'rating': rating,
                    'pubdate': book.pubdate.isoformat() if book.pubdate else None,
                    'timestamp': book.timestamp.isoformat() if book.timestamp else None,
                    'tags': tags,
                    'languages': languages,
                    'formats': formats,
                    'path': book.path,
                    'has_cover': has_cover,
                    'comments': book.comments[0].text if book.comments else None
                }
                books_data.append(book_data)
            
            return {
                'books': books_data,
                'total': total_count,
                'page': page,
                'per_page': per_page,
                'pages': (total_count + per_page - 1) // per_page
            }
            
        except Exception as e:
            logger.error(f"Error querying Calibre database: {e}")
            raise
        finally:
            self.close_session(session)
    
    def get_book_details(self, book_id: int) -> Optional[Dict[str, Any]]:
        """Get detailed information for a specific book"""
        session = self.get_session()
        try:
            book = session.query(Books).filter(Books.id == book_id).first()
            if not book:
                return None
            
            # Get all related data
            authors = [{'id': author.id, 'name': author.name} for author in book.authors]
            series_info = None
            if book.series:
                series_info = {
                    'id': book.series[0].id,
                    'name': book.series[0].name,
                    'index': float(book.series_index) if book.series_index else None
                }
            
            tags = [{'id': tag.id, 'name': tag.name} for tag in book.tags]
            languages = [{'id': lang.id, 'code': lang.lang_code} for lang in book.languages]
            formats = [{'format': data.format.upper(), 'size': data.uncompressed_size} for data in book.data]
            
            # Get rating (from ratings relationship)
            rating = None
            if book.ratings:
                rating = book.ratings[0].rating / 2  # Convert from 0-10 to 0-5
            
            has_cover = os.path.exists(os.path.join(self.db_path.parent, book.path, 'cover.jpg'))
            
            return {
                'id': book.id,
                'title': book.title,
                'sort': book.sort,
                'authors': authors,
                'series': series_info,
                'rating': rating,
                'pubdate': book.pubdate.isoformat() if book.pubdate else None,
                'timestamp': book.timestamp.isoformat() if book.timestamp else None,
                'last_modified': book.last_modified.isoformat() if book.last_modified else None,
                'tags': tags,
                'languages': languages,
                'formats': formats,
                'path': book.path,
                'has_cover': has_cover,
                'comments': book.comments[0].text if book.comments else None,
                'isbn': book.isbn,
                'uuid': book.uuid
            }
            
        except Exception as e:
            logger.error(f"Error getting book details: {e}")
            raise
        finally:
            self.close_session(session)
    
    def get_authors(self) -> List[Dict[str, Any]]:
        """Get all authors"""
        session = self.get_session()
        try:
            authors = session.query(Authors).order_by(Authors.sort).all()
            return [{'id': author.id, 'name': author.name, 'sort': author.sort} for author in authors]
        finally:
            self.close_session(session)
    
    def get_series(self) -> List[Dict[str, Any]]:
        """Get all series"""
        session = self.get_session()
        try:
            series = session.query(Series).order_by(Series.sort).all()
            return [{'id': s.id, 'name': s.name, 'sort': s.sort} for s in series]
        finally:
            self.close_session(session)
    
    def get_tags(self) -> List[Dict[str, Any]]:
        """Get all tags"""
        session = self.get_session()
        try:
            tags = session.query(Tags).order_by(Tags.name).all()
            return [{'id': tag.id, 'name': tag.name} for tag in tags]
        finally:
            self.close_session(session)
    
    def get_library_stats(self) -> Dict[str, int]:
        """Get library statistics"""
        session = self.get_session()
        try:
            stats = {
                'total_books': session.query(Books).count(),
                'total_authors': session.query(Authors).count(),
                'total_series': session.query(Series).count(),
                'total_tags': session.query(Tags).count()
            }
            return stats
        finally:
            self.close_session(session)
    
    def find_duplicates(self) -> Dict[str, Any]:
        """Find potential duplicate books using multiple criteria"""
        session = self.get_session()
        try:
            duplicates = {
                'by_title': [],
                'by_isbn': [],
                'by_title_author': [],
                'by_file_hash': []  # Future: could implement file hash comparison
            }
            
            # Find duplicates by exact title match
            title_duplicates = session.query(Books.title, func.count(Books.id).label('count'))\
                .group_by(Books.title)\
                .having(func.count(Books.id) > 1)\
                .all()
            
            for title, count in title_duplicates:
                books = session.query(Books).filter(Books.title == title).all()
                duplicate_group = []
                for book in books:
                    authors = [author.name for author in book.authors]
                    duplicate_group.append({
                        'id': book.id,
                        'title': book.title,
                        'authors': authors,
                        'path': book.path,
                        'timestamp': book.timestamp.isoformat() if book.timestamp else None,
                        'formats': [data.format.upper() for data in book.data],
                        'file_size': sum(data.uncompressed_size or 0 for data in book.data)
                    })
                duplicates['by_title'].append({
                    'title': title,
                    'count': count,
                    'books': duplicate_group
                })
            
            # Find duplicates by ISBN
            isbn_duplicates = session.query(Books.isbn, func.count(Books.id).label('count'))\
                .filter(Books.isbn != '')\
                .filter(Books.isbn.isnot(None))\
                .group_by(Books.isbn)\
                .having(func.count(Books.id) > 1)\
                .all()
            
            for isbn, count in isbn_duplicates:
                books = session.query(Books).filter(Books.isbn == isbn).all()
                duplicate_group = []
                for book in books:
                    authors = [author.name for author in book.authors]
                    duplicate_group.append({
                        'id': book.id,
                        'title': book.title,
                        'authors': authors,
                        'isbn': book.isbn,
                        'path': book.path,
                        'timestamp': book.timestamp.isoformat() if book.timestamp else None,
                        'formats': [data.format.upper() for data in book.data],
                        'file_size': sum(data.uncompressed_size or 0 for data in book.data)
                    })
                duplicates['by_isbn'].append({
                    'isbn': isbn,
                    'count': count,
                    'books': duplicate_group
                })
            
            # Find duplicates by title + primary author
            title_author_duplicates = session.query(
                Books.title,
                Authors.name.label('author_name'),
                func.count(Books.id).label('count')
            ).join(Books.authors)\
            .group_by(Books.title, Authors.name)\
            .having(func.count(Books.id) > 1)\
            .all()
            
            for title, author_name, count in title_author_duplicates:
                books = session.query(Books)\
                    .join(Books.authors)\
                    .filter(Books.title == title)\
                    .filter(Authors.name == author_name)\
                    .all()
                
                duplicate_group = []
                for book in books:
                    authors = [author.name for author in book.authors]
                    duplicate_group.append({
                        'id': book.id,
                        'title': book.title,
                        'authors': authors,
                        'path': book.path,
                        'timestamp': book.timestamp.isoformat() if book.timestamp else None,
                        'formats': [data.format.upper() for data in book.data],
                        'file_size': sum(data.uncompressed_size or 0 for data in book.data)
                    })
                
                duplicates['by_title_author'].append({
                    'title': title,
                    'author': author_name,
                    'count': count,
                    'books': duplicate_group
                })
            
            # Summary statistics
            total_duplicate_books = sum(
                sum(group['count'] for group in duplicates[category])
                for category in duplicates
                if category != 'by_file_hash'
            )
            
            return {
                'duplicates': duplicates,
                'summary': {
                    'total_duplicate_groups': sum(len(duplicates[cat]) for cat in duplicates),
                    'total_duplicate_books': total_duplicate_books,
                    'by_category': {
                        'title': len(duplicates['by_title']),
                        'isbn': len(duplicates['by_isbn']),
                        'title_author': len(duplicates['by_title_author'])
                    }
                }
            }
            
        except Exception as e:
            logger.error(f"Error finding duplicates: {e}")
            raise
        finally:
            self.close_session(session)
    
    def delete_book(self, book_id: int) -> bool:
        """Delete a book and all its related data"""
        session = self.get_session()
        try:
            book = session.query(Books).filter(Books.id == book_id).first()
            if not book:
                return False
            
            # Delete related data
            session.query(Data).filter(Data.book == book_id).delete()
            session.query(Comments).filter(Comments.book == book_id).delete()
            
            # Remove book from association tables (SQLAlchemy handles this automatically with relationships)
            session.delete(book)
            session.commit()
            
            logger.info(f"Deleted book {book_id}: {book.title}")
            return True
            
        except Exception as e:
            session.rollback()
            logger.error(f"Error deleting book {book_id}: {e}")
            raise
        finally:
            self.close_session(session)
    
    def bulk_delete_books(self, book_ids: List[int]) -> Dict[str, Any]:
        """Delete multiple books in bulk"""
        session = self.get_session()
        try:
            deleted_books = []
            failed_books = []
            
            for book_id in book_ids:
                try:
                    book = session.query(Books).filter(Books.id == book_id).first()
                    if book:
                        title = book.title
                        
                        # Delete related data
                        session.query(Data).filter(Data.book == book_id).delete()
                        session.query(Comments).filter(Comments.book == book_id).delete()
                        
                        # Delete the book
                        session.delete(book)
                        deleted_books.append({'id': book_id, 'title': title})
                    else:
                        failed_books.append({'id': book_id, 'error': 'Book not found'})
                        
                except Exception as e:
                    failed_books.append({'id': book_id, 'error': str(e)})
            
            session.commit()
            
            result = {
                'deleted_count': len(deleted_books),
                'failed_count': len(failed_books),
                'deleted_books': deleted_books,
                'failed_books': failed_books
            }
            
            logger.info(f"Bulk delete completed: {len(deleted_books)} deleted, {len(failed_books)} failed")
            return result
            
        except Exception as e:
            session.rollback()
            logger.error(f"Error in bulk delete: {e}")
            raise
        finally:
            self.close_session(session)
    
    def get_book_formats(self, book_id: int) -> List[str]:
        """Get available formats for a specific book"""
        session = self.get_session()
        try:
            formats = session.query(Data.format).filter(Data.book == book_id).all()
            return [format_tuple[0].upper() for format_tuple in formats]
        except Exception as e:
            logger.error(f"Error fetching formats for book {book_id}: {e}")
            return []
        finally:
            self.close_session(session)

# Global instance
_calibre_db_manager = None

def get_calibre_db_manager(metadata_db_path: str = None) -> CalibreDBManager:
    """Get or create the global Calibre DB manager instance"""
    global _calibre_db_manager
    
    if _calibre_db_manager is None and metadata_db_path:
        _calibre_db_manager = CalibreDBManager(metadata_db_path)
    
    return _calibre_db_manager