"""
Database manager for accessing Calibre metadata.db
"""

import os
import shutil
import tempfile
import threading
import time
from contextlib import contextmanager
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

class LocalDatabaseManager:
    def __init__(self, source_db_path, refresh_interval=300):  # 5 minutes default
        self.source_db_path = source_db_path
        self.temp_db_path = None
        self.refresh_interval = refresh_interval
        self.refresh_thread = None
        self.running = False
        
    def refresh_local_copy(self):
        """Create/refresh local copy of the database"""
        if self.temp_db_path:
            try:
                os.unlink(self.temp_db_path)
            except:
                pass
                
        with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as temp_file:
            self.temp_db_path = temp_file.name
            
        shutil.copy2(self.source_db_path, self.temp_db_path)
        print(f"Database copy refreshed: {self.temp_db_path}")
        return self.temp_db_path
    
    def start_auto_refresh(self):
        """Start automatic database refresh in background"""
        if self.refresh_thread and self.refresh_thread.is_alive():
            return
            
        self.running = True
        self.refresh_thread = threading.Thread(target=self._refresh_loop, daemon=True)
        self.refresh_thread.start()
        print(f"Auto-refresh started (every {self.refresh_interval} seconds)")
    
    def stop_auto_refresh(self):
        """Stop automatic database refresh"""
        self.running = False
        if self.refresh_thread:
            self.refresh_thread.join(timeout=1)
    
    def _refresh_loop(self):
        """Background refresh loop"""
        while self.running:
            try:
                time.sleep(self.refresh_interval)
                if self.running:  # Check again after sleep
                    self.refresh_local_copy()
            except Exception as e:
                print(f"Database refresh error: {e}")
                time.sleep(60)  # Wait longer on error
    
    @contextmanager
    def get_connection(self):
        """Get database connection with automatic cleanup"""
        if not self.temp_db_path or not os.path.exists(self.temp_db_path):
            self.refresh_local_copy()
            
        engine = create_engine(f'sqlite:///{self.temp_db_path}',
                             echo=False,
                             connect_args={'timeout': 10},
                             poolclass=NullPool)
        try:
            with engine.begin() as connection:
                yield connection
        finally:
            engine.dispose()
    
    def get_library_stats(self):
        """Get basic library statistics"""
        try:
            with self.get_connection() as conn:
                result = conn.execute(text("""
                    SELECT 
                        COUNT(*) as total_books,
                        COUNT(CASE WHEN has_cover = 1 THEN 1 END) as books_with_covers,
                        (SELECT COUNT(*) FROM authors) as total_authors,
                        (SELECT COUNT(*) FROM tags) as total_tags
                    FROM books
                """)).fetchone()
                
                return {
                    'total_books': result[0],
                    'books_with_covers': result[1], 
                    'total_authors': result[2],
                    'total_tags': result[3],
                    'coverage_percentage': (result[1] / result[0] * 100) if result[0] > 0 else 0
                }
        except Exception as e:
            print(f"Error getting library stats: {e}")
            return None
    
    def get_books(self, limit=50, offset=0, search_term=None):
        """Get books with optional search and pagination"""
        try:
            with self.get_connection() as conn:
                if search_term:
                    query = text("""
                        SELECT b.id, b.title, b.has_cover, b.path,
                               GROUP_CONCAT(a.name, ', ') as authors
                        FROM books b
                        LEFT JOIN books_authors_link bal ON b.id = bal.book
                        LEFT JOIN authors a ON bal.author = a.id
                        WHERE b.title LIKE :search OR a.name LIKE :search
                        GROUP BY b.id, b.title, b.has_cover, b.path
                        ORDER BY b.title
                        LIMIT :limit OFFSET :offset
                    """)
                    result = conn.execute(query, {
                        'search': f'%{search_term}%',
                        'limit': limit,
                        'offset': offset
                    }).fetchall()
                else:
                    query = text("""
                        SELECT b.id, b.title, b.has_cover, b.path,
                               GROUP_CONCAT(a.name, ', ') as authors
                        FROM books b
                        LEFT JOIN books_authors_link bal ON b.id = bal.book
                        LEFT JOIN authors a ON bal.author = a.id
                        GROUP BY b.id, b.title, b.has_cover, b.path
                        ORDER BY b.id DESC
                        LIMIT :limit OFFSET :offset
                    """)
                    result = conn.execute(query, {
                        'limit': limit,
                        'offset': offset
                    }).fetchall()
                
                books = []
                for row in result:
                    books.append({
                        'id': row[0],
                        'title': row[1],
                        'has_cover': bool(row[2]),
                        'path': row[3],
                        'authors': row[4].split(', ') if row[4] else []
                    })
                
                return books
                
        except Exception as e:
            print(f"Error getting books: {e}")
            return []
    
    def cleanup(self):
        """Clean up temporary files"""
        self.stop_auto_refresh()
        if self.temp_db_path and os.path.exists(self.temp_db_path):
            try:
                os.unlink(self.temp_db_path)
                print("Temporary database file cleaned up")
            except:
                pass
