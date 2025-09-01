"""CWA client and database helper utilities"""

import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

def get_cwa_client():
    """Get CWA client with current settings"""
    from cwa_client import CWAClient
    from cwa_settings import cwa_settings
    
    settings = cwa_settings.load_settings()
    if settings.get('enabled', False):
        return CWAClient(
            base_url=settings.get('base_url'),
            username=settings.get('username'),
            password=settings.get('password')
        )
    return None

def get_calibre_db_manager():
    """Get or create Calibre DB manager instance"""
    from calibre_db_manager import CalibreDBManager
    
    # Use a global variable to cache the instance
    if not hasattr(get_calibre_db_manager, '_instance'):
        get_calibre_db_manager._instance = None
        
    if get_calibre_db_manager._instance is None:
        metadata_db_path = os.path.join('/app/cwa-data/config/library/metadata.db')
        if os.path.exists(metadata_db_path):
            get_calibre_db_manager._instance = CalibreDBManager(metadata_db_path)
        else:
            logger.warning(f"Calibre metadata.db not found at {metadata_db_path}")
    
    return get_calibre_db_manager._instance
