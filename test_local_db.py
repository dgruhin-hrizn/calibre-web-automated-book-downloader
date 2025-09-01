#!/usr/bin/env python3
"""
Simple test script to access metadata.db as a local file
"""

import os
import sqlite3
import shutil
import tempfile
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

def test_local_database():
    # Your database path (treating as local)
    metadata_db_path = "/Volumes/2TBSSD/working/Book Backup/metadata.db"
    
    print("🔍 Testing metadata.db as local file...")
    print(f"📄 Database path: {metadata_db_path}")
    print("-" * 60)
    
    # Test 1: Check if file exists
    if not os.path.exists(metadata_db_path):
        print(f"❌ Database not found: {metadata_db_path}")
        return False
    
    file_size = os.path.getsize(metadata_db_path)
    print(f"✅ Database found: {file_size:,} bytes ({file_size / (1024*1024):.1f} MB)")
    
    # Test 2: Copy to local temp file (safest approach)
    print("\n📋 Creating local copy for safe access...")
    try:
        with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as temp_file:
            temp_db_path = temp_file.name
        
        print(f"   Copying to: {temp_db_path}")
        shutil.copy2(metadata_db_path, temp_db_path)
        print("   ✅ Copy completed")
        
    except Exception as e:
        print(f"   ❌ Copy failed: {e}")
        return False
    
    # Test 3: Test SQLite connection on local copy
    print("\n🔗 Testing SQLite connection...")
    try:
        conn = sqlite3.connect(temp_db_path, timeout=10)
        
        # Get basic info
        cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        tables = [row[0] for row in cursor.fetchall()]
        print(f"✅ Connected successfully, found {len(tables)} tables")
        
        # Get book count
        cursor = conn.execute("SELECT COUNT(*) FROM books")
        book_count = cursor.fetchone()[0]
        print(f"✅ Total books: {book_count:,}")
        
        # Get author count
        cursor = conn.execute("SELECT COUNT(*) FROM authors")
        author_count = cursor.fetchone()[0]
        print(f"✅ Total authors: {author_count:,}")
        
        # Get sample books
        print("\n📚 Sample books:")
        cursor = conn.execute("""
            SELECT b.id, b.title, b.has_cover, 
                   GROUP_CONCAT(a.name, ', ') as authors
            FROM books b
            LEFT JOIN books_authors_link bal ON b.id = bal.book
            LEFT JOIN authors a ON bal.author = a.id
            GROUP BY b.id, b.title, b.has_cover
            LIMIT 5
        """)
        
        for row in cursor.fetchall():
            book_id, title, has_cover, authors = row
            cover_icon = "📖" if has_cover else "📄"
            title_short = title[:50] + "..." if len(title) > 50 else title
            authors_short = authors[:30] + "..." if authors and len(authors) > 30 else authors
            print(f"   {cover_icon} [{book_id}] {title_short}")
            print(f"       by {authors_short or 'Unknown Author'}")
        
        conn.close()
        
    except Exception as e:
        print(f"❌ SQLite test failed: {e}")
        # Clean up temp file
        try:
            os.unlink(temp_db_path)
        except:
            pass
        return False
    
    # Test 4: Test SQLAlchemy connection
    print("\n🔧 Testing SQLAlchemy connection...")
    try:
        engine = create_engine(f'sqlite:///{temp_db_path}',
                             echo=False,
                             connect_args={'timeout': 10},
                             poolclass=NullPool)
        
        with engine.begin() as connection:
            result = connection.execute(text("SELECT COUNT(*) FROM books")).fetchone()
            print(f"✅ SQLAlchemy test successful: {result[0]:,} books")
            
            # Test a more complex query
            result = connection.execute(text("""
                SELECT 
                    COUNT(*) as total_books,
                    COUNT(CASE WHEN has_cover = 1 THEN 1 END) as books_with_covers,
                    (SELECT COUNT(*) FROM authors) as total_authors,
                    (SELECT COUNT(*) FROM tags) as total_tags
                FROM books
            """)).fetchone()
            
            total_books, books_with_covers, total_authors, total_tags = result
            print(f"✅ Library stats:")
            print(f"   📚 Books: {total_books:,}")
            print(f"   📖 With covers: {books_with_covers:,} ({books_with_covers/total_books*100:.1f}%)")
            print(f"   ✍️  Authors: {total_authors:,}")
            print(f"   🏷️  Tags: {total_tags:,}")
        
        engine.dispose()
        
    except Exception as e:
        print(f"❌ SQLAlchemy test failed: {e}")
        # Clean up temp file
        try:
            os.unlink(temp_db_path)
        except:
            pass
        return False
    
    # Clean up temp file
    try:
        os.unlink(temp_db_path)
        print(f"\n🧹 Cleaned up temporary file")
    except:
        pass
    
    print("\n🎉 All tests passed!")
    return True

def create_database_manager_example():
    """Show example of how to integrate this into your Flask app"""
    print("\n" + "="*60)
    print("💡 Flask Integration Example:")
    print("="*60)
    
    example_code = '''
# database_manager.py
import os
import shutil
import tempfile
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool
from contextlib import contextmanager

class LocalDatabaseManager:
    def __init__(self, source_db_path):
        self.source_db_path = source_db_path
        self.temp_db_path = None
        
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
        return self.temp_db_path
    
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

# In your Flask app:
db_manager = LocalDatabaseManager("/Volumes/2TBSSD/working/Book Backup/metadata.db")

@app.route('/api/books')
def get_books():
    try:
        with db_manager.get_connection() as conn:
            result = conn.execute(text("""
                SELECT b.id, b.title, b.has_cover,
                       GROUP_CONCAT(a.name, ', ') as authors
                FROM books b
                LEFT JOIN books_authors_link bal ON b.id = bal.book
                LEFT JOIN authors a ON bal.author = a.id
                GROUP BY b.id
                LIMIT 50
            """)).fetchall()
            
            books = []
            for row in result:
                books.append({
                    'id': row[0],
                    'title': row[1],
                    'has_cover': bool(row[2]),
                    'authors': row[3].split(', ') if row[3] else []
                })
            
            return jsonify(books)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Refresh database copy every 5 minutes
@app.before_first_request
def setup_periodic_refresh():
    import threading
    import time
    
    def refresh_loop():
        while True:
            time.sleep(300)  # 5 minutes
            try:
                db_manager.refresh_local_copy()
                print("Database copy refreshed")
            except Exception as e:
                print(f"Database refresh failed: {e}")
    
    refresh_thread = threading.Thread(target=refresh_loop, daemon=True)
    refresh_thread.start()
'''
    
    print(example_code)

if __name__ == "__main__":
    print("🚀 Starting local database test...\n")
    
    success = test_local_database()
    
    if success:
        create_database_manager_example()
        print("\n🎯 Next steps:")
        print("   1. The database is accessible via local copy approach")
        print("   2. Implement the database manager in your Flask app")
        print("   3. Set up periodic refresh (every 5-10 minutes)")
        print("   4. Add error handling and fallback mechanisms")
    else:
        print("\n❌ Database access failed")
