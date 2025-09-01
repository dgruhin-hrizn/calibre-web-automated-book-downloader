#!/usr/bin/env python3
"""
Simple test script to access metadata.db on SMB network share
"""

import os
import sqlite3
from pathlib import Path
import sys

def test_metadata_db():
    # Your SMB mount path
    base_path = "/Volumes/2TBSSD/working/Book Backup"
    metadata_db_path = os.path.join(base_path, "metadata.db")
    
    print("🔍 Testing metadata.db access on SMB share...")
    print(f"📂 Base path: {base_path}")
    print(f"📄 Database path: {metadata_db_path}")
    print("-" * 60)
    
    # Test 1: Check if mount point exists
    print("1️⃣ Testing mount point...")
    if not os.path.exists(base_path):
        print(f"❌ Mount point does not exist: {base_path}")
        print("   Make sure your SMB share is mounted")
        return False
    print(f"✅ Mount point exists: {base_path}")
    
    # Test 2: Check if metadata.db exists
    print("\n2️⃣ Testing metadata.db file...")
    if not os.path.exists(metadata_db_path):
        print(f"❌ metadata.db not found at: {metadata_db_path}")
        print("   Available files in directory:")
        try:
            files = os.listdir(base_path)
            for file in sorted(files)[:10]:  # Show first 10 files
                print(f"   - {file}")
            if len(files) > 10:
                print(f"   ... and {len(files) - 10} more files")
        except Exception as e:
            print(f"   Error listing directory: {e}")
        return False
    print(f"✅ metadata.db found: {metadata_db_path}")
    
    # Test 3: Check file permissions and size
    print("\n3️⃣ Testing file access...")
    try:
        stat = os.stat(metadata_db_path)
        file_size = stat.st_size
        print(f"✅ File size: {file_size:,} bytes ({file_size / (1024*1024):.1f} MB)")
        
        if not os.access(metadata_db_path, os.R_OK):
            print("❌ No read permission for metadata.db")
            return False
        print("✅ Read permission: OK")
        
    except Exception as e:
        print(f"❌ Error accessing file: {e}")
        return False
    
    # Test 4: Test basic file read
    print("\n4️⃣ Testing basic file read...")
    try:
        with open(metadata_db_path, 'rb') as f:
            header = f.read(100)
            if header.startswith(b'SQLite format 3'):
                print("✅ Valid SQLite database header detected")
            else:
                print("❌ Invalid SQLite database header")
                return False
    except Exception as e:
        print(f"❌ Error reading file: {e}")
        return False
    
    # Test 5: Test SQLite connection
    print("\n5️⃣ Testing SQLite connection...")
    
    # Try different connection methods
    connection_methods = [
        ("Read-only URI", f"file:{metadata_db_path}?mode=ro"),
        ("Read-only URI with cache", f"file:{metadata_db_path}?mode=ro&cache=shared"),
        ("Direct path", metadata_db_path),
        ("Direct path (read-only)", metadata_db_path)
    ]
    
    conn = None
    successful_method = None
    
    for method_name, connection_string in connection_methods:
        print(f"   Trying {method_name}...")
        try:
            if method_name == "Direct path (read-only)":
                conn = sqlite3.connect(
                    connection_string,
                    timeout=30,
                    check_same_thread=False
                )
                # Set read-only after connection
                conn.execute("PRAGMA query_only=1")
            else:
                conn = sqlite3.connect(
                    connection_string,
                    timeout=30,
                    check_same_thread=False
                )
            
            # Test the connection with a simple query
            cursor = conn.execute("SELECT 1")
            cursor.fetchone()
            
            successful_method = method_name
            print(f"   ✅ Success with: {method_name}")
            break
            
        except Exception as e:
            print(f"   ❌ Failed with {method_name}: {e}")
            if conn:
                try:
                    conn.close()
                except:
                    pass
                conn = None
            continue
    
    if not conn:
        print("❌ All SQLite connection methods failed")
        print("   This is common with SQLite over network shares")
        print("   Consider copying the database locally for testing")
        return False
    
    try:
        
        # Set network-safe pragmas
        conn.execute("PRAGMA journal_mode=DELETE")  # No WAL on network shares
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA cache_size=10000")
        
        print("✅ SQLite connection established")
        
        # Test 6: Basic database queries
        print("\n6️⃣ Testing basic queries...")
        
        # Get table list
        cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        tables = [row[0] for row in cursor.fetchall()]
        print(f"✅ Found {len(tables)} tables: {', '.join(tables[:5])}{'...' if len(tables) > 5 else ''}")
        
        # Get book count
        cursor = conn.execute("SELECT COUNT(*) FROM books")
        book_count = cursor.fetchone()[0]
        print(f"✅ Total books in library: {book_count:,}")
        
        # Get author count
        cursor = conn.execute("SELECT COUNT(*) FROM authors")
        author_count = cursor.fetchone()[0]
        print(f"✅ Total authors: {author_count:,}")
        
        # Get sample book data
        cursor = conn.execute("""
            SELECT b.id, b.title, b.has_cover, a.name as author
            FROM books b
            LEFT JOIN books_authors_link bal ON b.id = bal.book
            LEFT JOIN authors a ON bal.author = a.id
            LIMIT 5
        """)
        
        print("\n📚 Sample books:")
        for row in cursor.fetchall():
            book_id, title, has_cover, author = row
            cover_status = "📖" if has_cover else "📄"
            print(f"   {cover_status} [{book_id}] {title} - {author or 'Unknown Author'}")
        
        conn.close()
        print("\n✅ Database connection closed successfully")
        
    except Exception as e:
        print(f"❌ SQLite connection failed: {e}")
        return False
    
    print("\n🎉 All tests passed! metadata.db is accessible via SMB")
    return True

def test_with_sqlalchemy():
    """Test with SQLAlchemy (similar to what we'd use in the app)"""
    print("\n" + "="*60)
    print("🔧 Testing with SQLAlchemy...")
    
    try:
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool
        
        base_path = "/Volumes/2TBSSD/working/Book Backup"
        metadata_db_path = os.path.join(base_path, "metadata.db")
        
        # Create engine with network-safe settings
        engine = create_engine('sqlite://',
                             echo=False,
                             connect_args={
                                 'check_same_thread': False,
                                 'timeout': 30,
                                 'isolation_level': 'DEFERRED'
                             },
                             poolclass=NullPool)
        
        with engine.begin() as connection:
            # Set network-safe pragmas
            connection.execute(text("PRAGMA journal_mode=DELETE"))
            connection.execute(text("PRAGMA synchronous=NORMAL"))
            connection.execute(text("PRAGMA cache_size=10000"))
            
            # Attach the database
            connection.execute(text(f"attach database 'file:{metadata_db_path}?mode=ro&cache=shared' as calibre;"))
            
            # Test query
            result = connection.execute(text("SELECT COUNT(*) FROM calibre.books")).fetchone()
            print(f"✅ SQLAlchemy test successful: {result[0]:,} books found")
            
        engine.dispose()
        
    except ImportError:
        print("⚠️  SQLAlchemy not available, install with: pip install sqlalchemy")
    except Exception as e:
        print(f"❌ SQLAlchemy test failed: {e}")

if __name__ == "__main__":
    print("🚀 Starting metadata.db connectivity test...\n")
    
    success = test_metadata_db()
    
    if success:
        test_with_sqlalchemy()
        print("\n🎯 Next steps:")
        print("   1. The database is accessible via SMB")
        print("   2. You can now integrate this into your Flask app")
        print("   3. Consider implementing caching for better performance")
    else:
        print("\n❌ Database access failed. Check your SMB mount and file permissions.")
        
        # Try copying database locally as a workaround
        print("\n🔄 Attempting local copy workaround...")
        if test_local_copy():
            print("\n💡 Recommendation: Use local copy approach for production")
        
        sys.exit(1)

def test_local_copy():
    """Test copying the database locally and accessing it"""
    import shutil
    import tempfile
    
    base_path = "/Volumes/2TBSSD/working/Book Backup"
    metadata_db_path = os.path.join(base_path, "metadata.db")
    
    try:
        # Create temporary local copy
        with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as temp_file:
            temp_db_path = temp_file.name
        
        print(f"   📋 Copying database to: {temp_db_path}")
        shutil.copy2(metadata_db_path, temp_db_path)
        
        print("   🔗 Testing local copy...")
        conn = sqlite3.connect(temp_db_path, timeout=10)
        
        # Test query
        cursor = conn.execute("SELECT COUNT(*) FROM books")
        book_count = cursor.fetchone()[0]
        print(f"   ✅ Local copy works: {book_count:,} books found")
        
        conn.close()
        
        # Clean up
        os.unlink(temp_db_path)
        
        return True
        
    except Exception as e:
        print(f"   ❌ Local copy test failed: {e}")
        return False
