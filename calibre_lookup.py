"""Simple Calibre database lookup utility for checking if books exist in library."""

import sqlite3
import os
from pathlib import Path
from typing import Optional, List, Dict, Set
from logger import setup_logger
from env import CWA_DB_PATH

logger = setup_logger(__name__)

class CalibreLookup:
    """Lightweight utility to check if books exist in Calibre database."""
    
    def __init__(self, db_path: Optional[Path] = None):
        """Initialize Calibre lookup with database path."""
        self.db_path = db_path or CWA_DB_PATH
        self.conn = None
        self._connect()
    
    def _connect(self) -> bool:
        """Connect to Calibre database."""
        if not self.db_path or not self.db_path.exists():
            logger.info("Calibre database not found or not configured")
            return False
        
        try:
            self.conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
            self.conn.row_factory = sqlite3.Row
            logger.info(f"Connected to Calibre database: {self.db_path}")
            return True
        except Exception as e:
            logger.error(f"Failed to connect to Calibre database: {e}")
            self.conn = None
            return False
    
    def is_available(self) -> bool:
        """Check if Calibre database is available."""
        return self.conn is not None
    
    def book_exists(self, title: str, author: str = None) -> bool:
        """Check if a book exists in the CWA database.
        
        Args:
            title: Book title to search for
            author: Optional author name to refine search
            
        Returns:
            bool: True if book exists in library
        """
        if not self.conn:
            return False
        
        try:
            cursor = self.conn.cursor()
            
            # Clean up title and author for comparison
            title_clean = title.lower().strip()
            
            if author:
                author_clean = author.lower().strip()
                # Search by both title and author in CWA enforcement table
                cursor.execute("""
                    SELECT id 
                    FROM cwa_enforcement
                    WHERE LOWER(book_title) LIKE ? AND LOWER(author) LIKE ?
                    LIMIT 1
                """, (f"%{title_clean}%", f"%{author_clean}%"))
            else:
                # Search by title only in CWA enforcement table
                cursor.execute("""
                    SELECT id 
                    FROM cwa_enforcement
                    WHERE LOWER(book_title) LIKE ? 
                    LIMIT 1
                """, (f"%{title_clean}%",))
            
            result = cursor.fetchone()
            return result is not None
            
        except Exception as e:
            logger.error(f"Error checking book existence: {e}")
            return False
    
    def books_exist_batch(self, books: List[Dict[str, str]]) -> Dict[str, bool]:
        """Check existence for multiple books at once.
        
        Args:
            books: List of dicts with 'id', 'title', and optionally 'author' keys
            
        Returns:
            Dict mapping book IDs to existence status
        """
        if not self.conn:
            return {book['id']: False for book in books}
        
        results = {}
        
        try:
            cursor = self.conn.cursor()
            
            for book in books:
                book_id = book['id']
                title = book.get('title', '').lower().strip()
                author = book.get('author', '').lower().strip() if book.get('author') else None
                
                if not title:
                    results[book_id] = False
                    continue
                
                if author:
                    cursor.execute("""
                        SELECT id 
                        FROM cwa_enforcement
                        WHERE LOWER(book_title) LIKE ? AND LOWER(author) LIKE ?
                        LIMIT 1
                    """, (f"%{title}%", f"%{author}%"))
                else:
                    cursor.execute("""
                        SELECT id 
                        FROM cwa_enforcement
                        WHERE LOWER(book_title) LIKE ? 
                        LIMIT 1
                    """, (f"%{title}%",))
                
                result = cursor.fetchone()
                results[book_id] = result is not None
                
        except Exception as e:
            logger.error(f"Error in batch book existence check: {e}")
            # Return False for all books on error
            results = {book['id']: False for book in books}
        
        return results
    
    def get_book_details(self, title: str, author: str = None) -> Optional[Dict]:
        """Get detailed information about a book from CWA database.
        
        Args:
            title: Book title to search for
            author: Optional author name to refine search
            
        Returns:
            Dict with book details if found, None otherwise
        """
        if not self.conn:
            return None
        
        try:
            cursor = self.conn.cursor()
            
            title_clean = title.lower().strip()
            
            if author:
                author_clean = author.lower().strip()
                cursor.execute("""
                    SELECT id, book_title, author, file_path, timestamp
                    FROM cwa_enforcement
                    WHERE LOWER(book_title) LIKE ? AND LOWER(author) LIKE ?
                    LIMIT 1
                """, (f"%{title_clean}%", f"%{author_clean}%"))
            else:
                cursor.execute("""
                    SELECT id, book_title, author, file_path, timestamp
                    FROM cwa_enforcement
                    WHERE LOWER(book_title) LIKE ? 
                    LIMIT 1
                """, (f"%{title_clean}%",))
            
            result = cursor.fetchone()
            if result:
                return dict(result)
            return None
            
        except Exception as e:
            logger.error(f"Error getting book details: {e}")
            return None
    
    def close(self):
        """Close database connection."""
        if self.conn:
            self.conn.close()
            self.conn = None

# Global instance
calibre_lookup = CalibreLookup()
