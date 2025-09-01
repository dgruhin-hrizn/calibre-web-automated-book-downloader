# CWA Core - Calibre-Web-Automated functionality integrated into our app
# Adapted from Calibre-Web-Automated project
# Copyright (C) 2024-2025 Calibre-Web Automated contributors
# SPDX-License-Identifier: GPL-3.0-or-later

from .database.cwa_db import CWA_DB
from .database.calibre_db import CalibreDB

__all__ = ['CWA_DB', 'CalibreDB']
