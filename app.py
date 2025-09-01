"""Flask web application for book download service with URL rewrite support."""

import logging
import io, re, os
import sqlite3
from functools import wraps
from flask import Flask, request, jsonify, render_template, send_file, send_from_directory, session
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash
from werkzeug.wrappers import Response
from flask import url_for as flask_url_for
import typing

from logger import setup_logger
from config import _SUPPORTED_BOOK_LANGUAGE, BOOK_LANGUAGE
from env import FLASK_HOST, FLASK_PORT, APP_ENV, CWA_DB_PATH, DEBUG, USING_EXTERNAL_BYPASSER, BUILD_VERSION, RELEASE_VERSION
import backend
from calibre_lookup import calibre_lookup
from cwa_client import CWAClient
from cwa_settings import cwa_settings
from cwa_core.database.calibre_db import CalibreDB
from cwa_core.database.cwa_db import CWA_DB

from models import SearchFilters

logger = setup_logger(__name__)
app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app)  # type: ignore
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0  # Disable caching
app.config['APPLICATION_ROOT'] = '/'

# Enable CORS for React frontend
CORS(app, 
     origins=['http://localhost:5173', 'http://127.0.0.1:5173'],
     supports_credentials=True,
     allow_headers=['Content-Type', 'Authorization'],
     methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'])

# Flask logger
app.logger.handlers = logger.handlers
app.logger.setLevel(logger.level)
# Also handle Werkzeug's logger
werkzeug_logger = logging.getLogger('werkzeug')
werkzeug_logger.handlers = logger.handlers
werkzeug_logger.setLevel(logger.level)

# Set up session configuration
# The secret key will reset every time we restart, which will
# require users to authenticate again
app.config.update(
    SECRET_KEY = os.urandom(64),
    SESSION_COOKIE_HTTPONLY = True,
    SESSION_COOKIE_SECURE = False,  # Set to True in production with HTTPS
    SESSION_COOKIE_SAMESITE = 'Lax',
    PERMANENT_SESSION_LIFETIME = 86400  # 24 hours
)

# Initialize CWA client with settings
def get_cwa_client():
    """Get CWA client with current settings"""
    settings = cwa_settings.load_settings()
    if settings.get('enabled', False):
        return CWAClient(
            base_url=settings.get('base_url'),
            username=settings.get('username'),
            password=settings.get('password')
        )
    return None

# Initialize with current settings
cwa_client = get_cwa_client()

# Initialize CWA database and Calibre library access
try:
    cwa_db = CWA_DB()
    calibre_db = CalibreDB()
    logger.info(f"CWA database initialized: {cwa_db.db_path}{cwa_db.db_file}")
    logger.info(f"Calibre library available: {calibre_db.is_available()}")
    if calibre_db.is_available():
        logger.info(f"Calibre library path: {calibre_db.library_path}")
except Exception as e:
    logger.error(f"Error initializing CWA databases: {e}")
    cwa_db = None
    calibre_db = None

def require_cwa_client():
    """Decorator to ensure CWA client is available"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            client = get_cwa_client()
            if not client:
                return jsonify({'error': 'CWA integration is disabled'}), 503
            return f(client, *args, **kwargs)
        return decorated_function
    return decorator

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # If the CWA_DB_PATH variable exists, but isn't a valid
        # path, return a server error
        if CWA_DB_PATH is not None and not os.path.isfile(CWA_DB_PATH):
            logger.error(f"CWA_DB_PATH is set to {CWA_DB_PATH} but this is not a valid path")
            return Response("Internal Server Error", 500)
        
        # Check if user is logged in via session
        if not session.get('logged_in') or not session.get('username'):
            return jsonify({"error": "Authentication required"}), 401
            
        return f(*args, **kwargs)
    return decorated_function

def register_dual_routes(app : Flask) -> None:
    """
    Register each route both with and without the /request prefix.
    This function should be called after all routes are defined.
    """
    # Store original url_map rules
    rules = list(app.url_map.iter_rules())
    
    # Add /request prefix to each rule
    for rule in rules:
        if rule.rule != '/request/' and rule.rule != '/request':  # Skip if it's already a request route
            # Create new routes with /request prefix, both with and without trailing slash
            base_rule = rule.rule[:-1] if rule.rule.endswith('/') else rule.rule
            if base_rule == '':  # Special case for root path
                app.add_url_rule('/request', f"root_request", 
                               view_func=app.view_functions[rule.endpoint],
                               methods=rule.methods)
                app.add_url_rule('/request/', f"root_request_slash", 
                               view_func=app.view_functions[rule.endpoint],
                               methods=rule.methods)
            else:
                app.add_url_rule(f"/request{base_rule}", 
                               f"{rule.endpoint}_request",
                               view_func=app.view_functions[rule.endpoint],
                               methods=rule.methods)
                app.add_url_rule(f"/request{base_rule}/", 
                               f"{rule.endpoint}_request_slash",
                               view_func=app.view_functions[rule.endpoint],
                               methods=rule.methods)
    app.jinja_env.globals['url_for'] = url_for_with_request

def url_for_with_request(endpoint : str, **values : typing.Any) -> str:
    """Generate URLs with /request prefix by default."""
    if endpoint == 'static':
        # For static files, add /request prefix
        url = flask_url_for(endpoint, **values)
        return f"/request{url}"
    return flask_url_for(endpoint, **values)

@app.route('/')
@login_required
def index() -> str:
    """
    Serve React frontend in production, or render template in development.
    """
    # Check if we have a built React app
    react_build_path = os.path.join(app.root_path, 'frontend', 'dist', 'index.html')
    if os.path.exists(react_build_path):
        return send_file(react_build_path)
    
    # Fallback to original template for development
    return render_template('index.html', 
                           book_languages=_SUPPORTED_BOOK_LANGUAGE, 
                           default_language=BOOK_LANGUAGE, 
                           debug=DEBUG,
                           build_version=BUILD_VERSION,
                           release_version=RELEASE_VERSION,
                           app_env=APP_ENV
                           )

# Serve React static files
@app.route('/assets/<path:filename>')
def react_assets(filename):
    """Serve React build assets."""
    return send_from_directory(os.path.join(app.root_path, 'frontend', 'dist', 'assets'), filename)

 

@app.route('/favico<path:_>')
@app.route('/request/favico<path:_>')
@app.route('/request/static/favico<path:_>')
def favicon(_ : typing.Any) -> Response:
    return send_from_directory(os.path.join(app.root_path, 'static', 'media'),
        'favicon.ico', mimetype='image/vnd.microsoft.icon')

from typing import Union, Tuple

if DEBUG:
    import subprocess
    import time
    if USING_EXTERNAL_BYPASSER:
        STOP_GUI = lambda: None  # No-op for external bypasser
    else:
        from cloudflare_bypasser import _reset_driver as STOP_GUI
    @app.route('/debug', methods=['GET'])
    @login_required
    def debug() -> Union[Response, Tuple[Response, int]]:
        """
        This will run the /app/debug.sh script, which will generate a debug zip with all the logs
        The file will be named /tmp/cwa-book-downloader-debug.zip
        And then return it to the user
        """
        try:
            # Run the debug script
            STOP_GUI()
            time.sleep(1)
            result = subprocess.run(['/app/genDebug.sh'], capture_output=True, text=True, check=True)
            if result.returncode != 0:
                raise Exception(f"Debug script failed: {result.stderr}")
            logger.info(f"Debug script executed: {result.stdout}")
            debug_file_path = result.stdout.strip().split('\n')[-1]
            if not os.path.exists(debug_file_path):
                logger.error("Debug zip file not found after running debug script")
                return jsonify({"error": "Failed to generate debug information"}), 500
                
            # Return the file to the user
            return send_file(
                debug_file_path,
                mimetype='application/zip',
                download_name=os.path.basename(debug_file_path),
                as_attachment=True
            )
        except subprocess.CalledProcessError as e:
            logger.error_trace(f"Debug script error: {e}, stdout: {e.stdout}, stderr: {e.stderr}")
            return jsonify({"error": f"Debug script failed: {e.stderr}"}), 500
        except Exception as e:
            logger.error_trace(f"Debug endpoint error: {e}")
            return jsonify({"error": str(e)}), 500

if DEBUG:
    @app.route('/api/restart', methods=['GET'])
    @login_required
    def restart() -> Union[Response, Tuple[Response, int]]:
        """
        Restart the application
        """
        os._exit(0)

@app.route('/api/login', methods=['POST'])
def api_login() -> Union[Response, Tuple[Response, int]]:
    """
    Login endpoint for session-based authentication.
    
    Expected JSON body:
    {
        "username": "user",
        "password": "pass"
    }
    
    Returns:
        JSON with login status and user info
    """
    try:
        data = request.get_json()
        if not data or not data.get('username') or not data.get('password'):
            return jsonify({"error": "Username and password required"}), 400
        
        username = data['username']
        password = data['password']
        
        # Validate credentials using existing authenticate logic
        if validate_credentials(username, password):
            # Set session data
            session['logged_in'] = True
            session['username'] = username
            session.permanent = True
            
            logger.info(f"User {username} logged in successfully")
            return jsonify({
                "success": True,
                "user": {"username": username}
            })
        else:
            logger.warning(f"Failed login attempt for user {username}")
            return jsonify({"error": "Invalid username or password"}), 401
            
    except Exception as e:
        logger.error_trace(f"Login error: {e}")
        return jsonify({"error": "Login failed"}), 500

@app.route('/api/logout', methods=['POST'])
def api_logout() -> Union[Response, Tuple[Response, int]]:
    """
    Logout endpoint to clear session.
    
    Returns:
        JSON with logout status
    """
    try:
        username = session.get('username', 'unknown')
        session.clear()
        logger.info(f"User {username} logged out")
        return jsonify({"success": True})
    except Exception as e:
        logger.error_trace(f"Logout error: {e}")
        return jsonify({"error": "Logout failed"}), 500

@app.route('/api/auth/check', methods=['GET'])
def api_auth_check() -> Union[Response, Tuple[Response, int]]:
    """
    Lightweight authentication check endpoint.
    
    Returns:
        JSON with authentication status and user info
    """
    try:
        if session.get('logged_in') and session.get('username'):
            return jsonify({
                "authenticated": True,
                "user": {"username": session.get('username')}
            })
        else:
            return jsonify({"authenticated": False}), 401
    except Exception as e:
        logger.error_trace(f"Auth check error: {e}")
        return jsonify({"authenticated": False}), 401

@app.route('/api/search', methods=['GET'])
@login_required
def api_search() -> Union[Response, Tuple[Response, int]]:
    """
    Search for books matching the provided query.

    Query Parameters:
        query (str): Search term (ISBN, title, author, etc.)
        isbn (str): Book ISBN
        author (str): Book Author
        title (str): Book Title
        lang (str): Book Language
        sort (str): Order to sort results
        content (str): Content type of book
        format (str): File format filter (pdf, epub, mobi, azw3, fb2, djvu, cbz, cbr)

    Returns:
        flask.Response: JSON array of matching books or error response.
    """
    query = request.args.get('query', '')

    filters = SearchFilters(
        isbn = request.args.getlist('isbn'),
        author = request.args.getlist('author'),
        title = request.args.getlist('title'),
        lang = request.args.getlist('lang'),
        sort = request.args.get('sort'),
        content = request.args.getlist('content'),
        format = request.args.getlist('format'),
    )

    if not query and not any(vars(filters).values()):
        return jsonify([])

    try:
        books = backend.search_books(query, filters)
        return jsonify(books)
    except Exception as e:
        logger.error_trace(f"Search error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/info', methods=['GET'])
@login_required
def api_info() -> Union[Response, Tuple[Response, int]]:
    """
    Get detailed book information.

    Query Parameters:
        id (str): Book identifier (MD5 hash)

    Returns:
        flask.Response: JSON object with book details, or an error message.
    """
    book_id = request.args.get('id', '')
    if not book_id:
        return jsonify({"error": "No book ID provided"}), 400

    try:
        book = backend.get_book_info(book_id)
        if book:
            return jsonify(book)
        return jsonify({"error": "Book not found"}), 404
    except Exception as e:
        logger.error_trace(f"Info error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/settings/google-books', methods=['GET', 'POST'])
@login_required
def api_google_books_settings() -> Union[Response, Tuple[Response, int]]:
    """
    Get or set Google Books API settings.
    
    GET: Returns current Google Books API settings
    POST: Updates Google Books API settings
    
    Returns:
        flask.Response: JSON object with settings or confirmation message
    """
    if request.method == 'GET':
        try:
            settings = backend.get_google_books_settings()
            return jsonify(settings)
        except Exception as e:
            logger.error_trace(f"Error getting Google Books settings: {e}")
            return jsonify({"error": str(e)}), 500
    
    elif request.method == 'POST':
        try:
            data = request.get_json()
            api_key = data.get('apiKey', '')
            is_valid = data.get('isValid', False)
            
            backend.save_google_books_settings(api_key, is_valid)
            return jsonify({"message": "Google Books API settings saved successfully"})
        except Exception as e:
            logger.error_trace(f"Error saving Google Books settings: {e}")
            return jsonify({"error": str(e)}), 500

@app.route('/api/settings/google-books/test', methods=['POST'])
@login_required
def api_test_google_books_key() -> Union[Response, Tuple[Response, int]]:
    """
    Test Google Books API key validity.
    
    Returns:
        flask.Response: JSON object with validity status
    """
    try:
        data = request.get_json()
        api_key = data.get('apiKey', '')
        
        is_valid = backend.test_google_books_api_key(api_key)
        return jsonify({"valid": is_valid})
    except Exception as e:
        logger.error_trace(f"Error testing Google Books API key: {e}")
        return jsonify({"valid": False, "error": str(e)}), 500

@app.route('/api/google-books/search', methods=['POST'])
@login_required
def api_google_books_search() -> Union[Response, Tuple[Response, int]]:
    """
    Search Google Books API for book information.
    
    Returns:
        flask.Response: JSON object with Google Books data
    """
    try:
        data = request.get_json()
        title = data.get('title', '')
        author = data.get('author', '')
        max_results = data.get('maxResults', 1)
        
        logger.info(f"Google Books search request: title='{title}', author='{author}', maxResults={max_results}")
        
        google_data = backend.search_google_books(title, author, max_results=max_results)
        if google_data:
            logger.info(f"Google Books search successful for '{title}'")
            return jsonify(google_data)
        else:
            logger.info(f"No Google Books data found for '{title}'")
            return jsonify({"error": "No Google Books data found"}), 404
    except Exception as e:
        logger.error_trace(f"Error searching Google Books: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/google-books/volume/<volume_id>', methods=['GET'])
@login_required
def api_google_books_volume_details(volume_id: str) -> Union[Response, Tuple[Response, int]]:
    """
    Get detailed Google Books volume information by volume ID.
    
    Returns:
        flask.Response: JSON object with detailed Google Books volume data
    """
    try:
        logger.info(f"Google Books volume details request for ID: {volume_id}")
        
        volume_data = backend.get_google_books_volume_details(volume_id)
        if volume_data:
            logger.info(f"Google Books volume details successful for '{volume_id}'")
            return jsonify(volume_data)
        else:
            logger.info(f"No Google Books volume data found for '{volume_id}'")
            return jsonify({"error": "No Google Books volume data found"}), 404
    except Exception as e:
        logger.error_trace(f"Error getting Google Books volume details: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/book-details/<book_id>', methods=['GET', 'POST'])
@login_required
def api_enhanced_book_details(book_id: str) -> Union[Response, Tuple[Response, int]]:
    """
    Get enhanced book details with Google Books API data.
    
    Args:
        book_id: Book identifier (MD5 hash)
    
    Returns:
        flask.Response: JSON object with enhanced book details
    """
    try:
        # Check if basic book info is provided in POST body to avoid re-fetching
        basic_book_info = None
        if request.method == 'POST':
            data = request.get_json()
            if data and 'basicBookInfo' in data:
                basic_book_info = data['basicBookInfo']
                logger.info("Using provided basic book info from request body")
        
        enhanced_details = backend.get_enhanced_book_details(book_id, basic_book_info)
        if enhanced_details:
            return jsonify(enhanced_details)
        return jsonify({"error": "Book not found"}), 404
    except Exception as e:
        logger.error_trace(f"Error getting enhanced book details: {e}")
        return jsonify({"error": str(e)}), 500



@app.route('/api/download', methods=['GET'])
@login_required
def api_download() -> Union[Response, Tuple[Response, int]]:
    """
    Queue a book for download.

    Query Parameters:
        id (str): Book identifier (MD5 hash)

    Returns:
        flask.Response: JSON status object indicating success or failure.
    """
    book_id = request.args.get('id', '')
    if not book_id:
        return jsonify({"error": "No book ID provided"}), 400

    try:
        priority = int(request.args.get('priority', 0))
        success = backend.queue_book(book_id, priority)
        if success:
            return jsonify({"status": "queued", "priority": priority})
        return jsonify({"error": "Failed to queue book"}), 500
    except Exception as e:
        logger.error_trace(f"Download error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/status', methods=['GET'])
@login_required
def api_status() -> Union[Response, Tuple[Response, int]]:
    """
    Get current download queue status.

    Returns:
        flask.Response: JSON object with queue status.
    """
    try:
        status = backend.queue_status()
        return jsonify(status)
    except Exception as e:
        logger.error_trace(f"Status error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/localdownload', methods=['GET'])
@login_required
def api_local_download() -> Union[Response, Tuple[Response, int]]:
    """
    Download an EPUB file from local storage if available.

    Query Parameters:
        id (str): Book identifier (MD5 hash)

    Returns:
        flask.Response: The EPUB file if found, otherwise an error response.
    """
    book_id = request.args.get('id', '')
    if not book_id:
        return jsonify({"error": "No book ID provided"}), 400

    try:
        file_data, book_info = backend.get_book_data(book_id)
        if file_data is None:
            # Book data not found or not available
            return jsonify({"error": "File not found"}), 404
        # Santize the file name
        file_name = book_info.title
        file_name = re.sub(r'[\\/:*?"<>|]', '_', file_name.strip())[:245]
        file_extension = book_info.format
        # Prepare the file for sending to the client
        data = io.BytesIO(file_data)
        return send_file(
            data,
            download_name=f"{file_name}.{file_extension}",
            as_attachment=True
        )

    except Exception as e:
        logger.error_trace(f"Local download error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/download/<book_id>/cancel', methods=['DELETE'])
@login_required
def api_cancel_download(book_id: str) -> Union[Response, Tuple[Response, int]]:
    """
    Cancel a download.

    Path Parameters:
        book_id (str): Book identifier to cancel

    Returns:
        flask.Response: JSON status indicating success or failure.
    """
    try:
        success = backend.cancel_download(book_id)
        if success:
            return jsonify({"status": "cancelled", "book_id": book_id})
        return jsonify({"error": "Failed to cancel download or book not found"}), 404
    except Exception as e:
        logger.error_trace(f"Cancel download error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/queue/<book_id>/priority', methods=['PUT'])
@login_required
def api_set_priority(book_id: str) -> Union[Response, Tuple[Response, int]]:
    """
    Set priority for a queued book.

    Path Parameters:
        book_id (str): Book identifier

    Request Body:
        priority (int): New priority level (lower number = higher priority)

    Returns:
        flask.Response: JSON status indicating success or failure.
    """
    try:
        data = request.get_json()
        if not data or 'priority' not in data:
            return jsonify({"error": "Priority not provided"}), 400
            
        priority = int(data['priority'])
        success = backend.set_book_priority(book_id, priority)
        
        if success:
            return jsonify({"status": "updated", "book_id": book_id, "priority": priority})
        return jsonify({"error": "Failed to update priority or book not found"}), 404
    except ValueError:
        return jsonify({"error": "Invalid priority value"}), 400
    except Exception as e:
        logger.error_trace(f"Set priority error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/queue/reorder', methods=['POST'])
@login_required
def api_reorder_queue() -> Union[Response, Tuple[Response, int]]:
    """
    Bulk reorder queue by setting new priorities.

    Request Body:
        book_priorities (dict): Mapping of book_id to new priority

    Returns:
        flask.Response: JSON status indicating success or failure.
    """
    try:
        data = request.get_json()
        if not data or 'book_priorities' not in data:
            return jsonify({"error": "book_priorities not provided"}), 400
            
        book_priorities = data['book_priorities']
        if not isinstance(book_priorities, dict):
            return jsonify({"error": "book_priorities must be a dictionary"}), 400
            
        # Validate all priorities are integers
        for book_id, priority in book_priorities.items():
            if not isinstance(priority, int):
                return jsonify({"error": f"Invalid priority for book {book_id}"}), 400
                
        success = backend.reorder_queue(book_priorities)
        
        if success:
            return jsonify({"status": "reordered", "updated_count": len(book_priorities)})
        return jsonify({"error": "Failed to reorder queue"}), 500
    except Exception as e:
        logger.error_trace(f"Reorder queue error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/queue/order', methods=['GET'])
@login_required
def api_queue_order() -> Union[Response, Tuple[Response, int]]:
    """
    Get current queue order for display.

    Returns:
        flask.Response: JSON array of queued books with their order and priorities.
    """
    try:
        queue_order = backend.get_queue_order()
        return jsonify({"queue": queue_order})
    except Exception as e:
        logger.error_trace(f"Queue order error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/downloads/active', methods=['GET'])
@login_required
def api_active_downloads() -> Union[Response, Tuple[Response, int]]:
    """
    Get list of currently active downloads.

    Returns:
        flask.Response: JSON array of active download book IDs.
    """
    try:
        active_downloads = backend.get_active_downloads()
        return jsonify({"active_downloads": active_downloads})
    except Exception as e:
        logger.error_trace(f"Active downloads error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/queue/clear', methods=['DELETE'])
@login_required
def api_clear_completed() -> Union[Response, Tuple[Response, int]]:
    """
    Clear all completed, errored, or cancelled books from tracking.

    Returns:
        flask.Response: JSON with count of removed books.
    """
    try:
        removed_count = backend.clear_completed()
        return jsonify({"status": "cleared", "removed_count": removed_count})
    except Exception as e:
        logger.error_trace(f"Clear completed error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/calibre/check', methods=['POST'])
@login_required
def api_calibre_check_books() -> Union[Response, Tuple[Response, int]]:
    """
    Check if books exist in Calibre library.
    
    Expected JSON body:
    {
        "books": [
            {"id": "book_id", "title": "Book Title", "author": "Author Name"},
            ...
        ]
    }
    
    Returns:
        JSON with book existence status for each book ID
    """
    try:
        if not calibre_lookup.is_available():
            return jsonify({"error": "Calibre database not available"}), 503
        
        data = request.get_json()
        if not data or 'books' not in data:
            return jsonify({"error": "Missing 'books' in request body"}), 400
        
        books = data['books']
        if not isinstance(books, list):
            return jsonify({"error": "'books' must be an array"}), 400
        
        # Check existence for all books
        existence_map = calibre_lookup.books_exist_batch(books)
        
        return jsonify({"exists": existence_map})
        
    except Exception as e:
        logger.error_trace(f"Calibre check error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/calibre/status', methods=['GET'])
@login_required
def api_calibre_status() -> Union[Response, Tuple[Response, int]]:
    """
    Get Calibre database availability status.
    
    Returns:
        JSON with Calibre database status
    """
    try:
        is_available = calibre_lookup.is_available()
        db_path = str(calibre_lookup.db_path) if calibre_lookup.db_path else None
        
        return jsonify({
            "available": is_available,
            "database_path": db_path,
            "configured": CWA_DB_PATH is not None
        })
        
    except Exception as e:
        logger.error_trace(f"Calibre status error: {e}")
        return jsonify({"error": str(e)}), 500

@app.errorhandler(404)
def not_found_error(error: Exception) -> Union[Response, Tuple[Response, int]]:
    """
    Handle 404 (Not Found) errors.

    Args:
        error (HTTPException): The 404 error raised by Flask.

    Returns:
        flask.Response: JSON error message with 404 status.
    """
    logger.warning(f"404 error: {request.url} : {error}")
    return jsonify({"error": "Resource not found"}), 404

@app.errorhandler(500)
def internal_error(error: Exception) -> Union[Response, Tuple[Response, int]]:
    """
    Handle 500 (Internal Server) errors.

    Args:
        error (HTTPException): The 500 error raised by Flask.

    Returns:
        flask.Response: JSON error message with 500 status.
    """
    logger.error_trace(f"500 error: {error}")
    return jsonify({"error": "Internal server error"}), 500

def validate_credentials(username: str, password: str) -> bool:
    """
    Helper function that validates credentials
    against a Calibre-Web app.db SQLite database

    Database structure:
    - Table 'user' with columns: 'name' (username), 'password'
    """

    # If the database doesn't exist, allow any credentials
    if not CWA_DB_PATH:
        return True

    # Look for app.db in the same directory as cwa.db for authentication
    try:
        # First, try to find app.db in the same directory as cwa.db
        cwa_dir = CWA_DB_PATH.parent
        app_db_path = cwa_dir / "app.db"
        
        if app_db_path.exists():
            # Use app.db for authentication
            db_path = os.fspath(app_db_path)
            logger.info(f"Using app.db for authentication: {app_db_path}")
        else:
            # Fall back to cwa.db and check if it has user table
            db_path = os.fspath(CWA_DB_PATH)
            logger.info(f"No app.db found, checking cwa.db for user table: {CWA_DB_PATH}")
        
        # Open database in true read-only mode to avoid journal/WAL writes on RO mounts
        db_uri = f"file:{db_path}?mode=ro&immutable=1"
        conn = sqlite3.connect(db_uri, uri=True)
        cur = conn.cursor()
        
        # Check if user table exists first
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='user'")
        if not cur.fetchone():
            # No user table exists, so no authentication required
            conn.close()
            logger.info("No user table found - authentication bypassed")
            return True
        
        cur.execute("SELECT password FROM user WHERE name = ?", (username,))
        row = cur.fetchone()
        conn.close()

        # Check if user exists and password is correct
        if not row or not row[0] or not check_password_hash(row[0], password):
            logger.error("User not found or password check failed")
            return False

    except Exception as e:
        logger.error_trace(f"Authentication error: {e}")
        return False

    logger.info(f"Authentication successful for user {username}")
    return True

# Register all routes with /request prefix
register_dual_routes(app)

# ============================================================================
# CWA Settings API Endpoints
# ============================================================================

@app.route('/api/cwa/settings', methods=['GET'])
@login_required
def api_cwa_get_settings():
    """Get current CWA settings"""
    try:
        settings = cwa_settings.get_current_settings()
        return jsonify(settings)
    except Exception as e:
        logger.error(f"Error getting CWA settings: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/cwa/settings', methods=['POST'])
@login_required
def api_cwa_save_settings():
    """Save CWA settings"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        # Save settings
        success = cwa_settings.save_settings(data)
        if not success:
            return jsonify({'error': 'Failed to save settings'}), 500
        
        # Update environment variables for runtime
        cwa_settings.update_env_vars(data)
        
        # Reinitialize CWA client with new settings
        global cwa_client
        cwa_client = get_cwa_client()
        
        return jsonify({
            'success': True,
            'message': 'CWA settings saved successfully'
        })
        
    except Exception as e:
        logger.error(f"Error saving CWA settings: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/cwa/settings/test', methods=['POST'])
@login_required
def api_cwa_test_connection():
    """Test CWA connection with provided settings"""
    try:
        data = request.get_json()
        if not data:
            # Test with current settings
            result = cwa_settings.test_connection()
        else:
            # Test with provided settings
            result = cwa_settings.test_connection(data)
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error testing CWA connection: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        })

# ============================================================================
# CWA Integration API Endpoints
# ============================================================================

@app.route('/api/cwa/status')
@login_required
def api_cwa_status():
    """Check CWA instance connection status"""
    try:
        client = get_cwa_client()
        if not client:
            return jsonify({
                'connected': False,
                'base_url': None,
                'authenticated': False,
                'error': 'CWA integration is disabled'
            })
            
        is_connected = client.check_connection()
        return jsonify({
            'connected': is_connected,
            'base_url': client.base_url,
            'authenticated': client.authenticated
        })
    except Exception as e:
        logger.error(f"Error checking CWA status: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/cwa/books')
@login_required
def api_cwa_books():
    """Get books from CWA library"""
    try:
        client = get_cwa_client()
        if not client:
            return jsonify({'error': 'CWA integration is disabled'}), 503
            
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 25, type=int)
        sort = request.args.get('sort', 'new')
        
        books = client.get_books(page=page, per_page=per_page, sort=sort)
        if books is None:
            return jsonify({'error': 'Failed to fetch books from CWA'}), 500
            
        return jsonify(books)
    except Exception as e:
        logger.error(f"Error fetching CWA books: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/cwa/search')
@login_required
def api_cwa_search():
    """Search books in CWA library"""
    try:
        query = request.args.get('query', '')
        page = request.args.get('page', 1, type=int)
        
        if not query:
            return jsonify({'error': 'Query parameter is required'}), 400
            
        results = cwa_client.search_books(query=query, page=page)
        if results is None:
            return jsonify({'error': 'Failed to search CWA library'}), 500
            
        return jsonify(results)
    except Exception as e:
        logger.error(f"Error searching CWA library: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/cwa/book/<int:book_id>')
@login_required
def api_cwa_book_details(book_id):
    """Get detailed information about a CWA book"""
    try:
        book_details = cwa_client.get_book_details(book_id)
        if book_details is None:
            return jsonify({'error': 'Book not found or failed to fetch details'}), 404
            
        return jsonify(book_details)
    except Exception as e:
        logger.error(f"Error fetching CWA book details: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/cwa/book/<int:book_id>/formats')
@login_required
def api_cwa_book_formats(book_id):
    """Get available formats for a CWA book"""
    try:
        formats = cwa_client.get_book_formats(book_id)
        if formats is None:
            return jsonify({'error': 'Failed to fetch book formats'}), 500
            
        return jsonify({'formats': formats})
    except Exception as e:
        logger.error(f"Error fetching CWA book formats: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/cwa/book/<int:book_id>/download/<format>')
@login_required
def api_cwa_download_book(book_id, format):
    """Download a book from CWA in specified format"""
    try:
        book_data = cwa_client.download_book(book_id, format)
        if book_data is None:
            return jsonify({'error': 'Failed to download book'}), 500
            
        # Get book details for filename
        book_details = cwa_client.get_book_details(book_id)
        filename = f"book_{book_id}.{format}"
        if book_details and 'title' in book_details:
            safe_title = "".join(c for c in book_details['title'] if c.isalnum() or c in (' ', '-', '_')).rstrip()
            filename = f"{safe_title}.{format}"
            
        return send_file(
            io.BytesIO(book_data),
            as_attachment=True,
            download_name=filename,
            mimetype=f'application/{format}'
        )
    except Exception as e:
        logger.error(f"Error downloading book from CWA: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/cwa/book/<int:book_id>/reader')
@login_required
def api_cwa_reader_url(book_id):
    """Get CWA reader URL for a book"""
    try:
        format = request.args.get('format', 'epub')
        reader_url = cwa_client.get_reader_url(book_id, format)
        
        return jsonify({
            'reader_url': reader_url,
            'book_id': book_id,
            'format': format
        })
    except Exception as e:
        logger.error(f"Error getting CWA reader URL: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/cwa/book/<int:book_id>/cover')
@login_required
def api_cwa_book_cover(book_id):
    """Get CWA book cover URL"""
    try:
        cover_url = cwa_client.get_cover_url(book_id)
        
        return jsonify({
            'cover_url': cover_url,
            'book_id': book_id
        })
    except Exception as e:
        logger.error(f"Error getting CWA book cover: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/cwa/authors')
@login_required
def api_cwa_authors():
    """Get authors from CWA library"""
    try:
        authors = cwa_client.get_authors()
        if authors is None:
            return jsonify({'error': 'Failed to fetch authors'}), 500
            
        return jsonify({'authors': authors})
    except Exception as e:
        logger.error(f"Error fetching CWA authors: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/cwa/series')
@login_required
def api_cwa_series():
    """Get series from CWA library"""
    try:
        series = cwa_client.get_series()
        if series is None:
            return jsonify({'error': 'Failed to fetch series'}), 500
            
        return jsonify({'series': series})
    except Exception as e:
        logger.error(f"Error fetching CWA series: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/cwa/categories')
@login_required
def api_cwa_categories():
    """Get categories from CWA library"""
    try:
        categories = cwa_client.get_categories()
        if categories is None:
            return jsonify({'error': 'Failed to fetch categories'}), 500
            
        return jsonify({'categories': categories})
    except Exception as e:
        logger.error(f"Error fetching CWA categories: {e}")
        return jsonify({'error': str(e)}), 500

# ============================================================================
# Calibre Library API Endpoints (Direct Database Access)
# ============================================================================

@app.route('/api/library/status')
@login_required
def api_library_status():
    """Check Calibre library status"""
    try:
        if not calibre_db:
            return jsonify({
                'available': False,
                'error': 'Library database not initialized'
            })
        
        return jsonify({
            'available': calibre_db.is_available(),
            'library_path': calibre_db.library_path,
            'cwa_db_available': cwa_db is not None
        })
    except Exception as e:
        logger.error(f"Error checking library status: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/library/books')
@login_required
def api_library_books():
    """Get books from Calibre library"""
    try:
        if not calibre_db or not calibre_db.is_available():
            return jsonify({'error': 'Calibre library not available'}), 503
        
        # Get query parameters
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 25, type=int)
        sort = request.args.get('sort', 'id')
        search = request.args.get('search', '')
        
        # Calculate offset
        offset = (page - 1) * per_page
        
        # Get books
        result = calibre_db.get_books(
            limit=per_page,
            offset=offset,
            sort_by=sort,
            search_query=search if search else None
        )
        
        # Add pagination info
        total_pages = (result['total'] + per_page - 1) // per_page
        result.update({
            'page': page,
            'per_page': per_page,
            'total_pages': total_pages
        })
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error fetching library books: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/library/books/<int:book_id>')
@login_required
def api_library_book_details(book_id):
    """Get detailed information about a library book"""
    try:
        if not calibre_db or not calibre_db.is_available():
            return jsonify({'error': 'Calibre library not available'}), 503
        
        book = calibre_db.get_book_by_id(book_id)
        if not book:
            return jsonify({'error': 'Book not found'}), 404
        
        return jsonify(book)
        
    except Exception as e:
        logger.error(f"Error fetching library book details: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/library/books/<int:book_id>/download/<format>')
@login_required
def api_library_download_book(book_id, format):
    """Download a book from the library"""
    try:
        if not calibre_db or not calibre_db.is_available():
            return jsonify({'error': 'Calibre library not available'}), 503
        
        # Get book details
        book = calibre_db.get_book_by_id(book_id)
        if not book:
            return jsonify({'error': 'Book not found'}), 404
        
        # Check if format is available
        if format.lower() not in [f.lower() for f in book.get('formats', [])]:
            return jsonify({'error': f'Format {format} not available'}), 404
        
        # Get file path
        file_path = calibre_db.get_book_file_path(book_id, format)
        if not file_path or not os.path.exists(file_path):
            return jsonify({'error': 'Book file not found'}), 404
        
        # Create safe filename
        safe_title = "".join(c for c in book['title'] if c.isalnum() or c in (' ', '-', '_')).rstrip()
        filename = f"{safe_title}.{format.lower()}"
        
        return send_file(
            file_path,
            as_attachment=True,
            download_name=filename,
            mimetype=f'application/{format.lower()}'
        )
        
    except Exception as e:
        logger.error(f"Error downloading library book: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/library/books/<int:book_id>/cover')
@login_required
def api_library_book_cover(book_id):
    """Get book cover image"""
    try:
        if not calibre_db or not calibre_db.is_available():
            return jsonify({'error': 'Calibre library not available'}), 503
        
        cover_path = calibre_db.get_cover_path(book_id)
        if not cover_path or not os.path.exists(cover_path):
            # Return a default cover or 404
            return jsonify({'error': 'Cover not found'}), 404
        
        return send_file(cover_path, mimetype='image/jpeg')
        
    except Exception as e:
        logger.error(f"Error fetching library book cover: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/library/search')
@login_required
def api_library_search():
    """Search books in library"""
    try:
        if not calibre_db or not calibre_db.is_available():
            return jsonify({'error': 'Calibre library not available'}), 503
        
        query = request.args.get('q', '')
        limit = request.args.get('limit', 25, type=int)
        
        if not query:
            return jsonify({'error': 'Query parameter required'}), 400
        
        books = calibre_db.search_books(query, limit)
        
        return jsonify({
            'books': books,
            'total': len(books),
            'query': query
        })
        
    except Exception as e:
        logger.error(f"Error searching library: {e}")
        return jsonify({'error': str(e)}), 500

logger.log_resource_usage()

if __name__ == '__main__':
    logger.info(f"Starting Flask application on {FLASK_HOST}:{FLASK_PORT} IN {APP_ENV} mode")
    app.run(
        host=FLASK_HOST,
        port=FLASK_PORT,
        debug=DEBUG 
    )
