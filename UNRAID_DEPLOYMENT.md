# CWA Book Downloader - Unraid Deployment Guide

This guide explains how to deploy the CWA Book Downloader with its modern React frontend on Unraid.

## Overview

The CWA Book Downloader provides a modern, beautiful React frontend for Calibre-Web-Automated book downloading. It packages both the frontend and backend into a single container for easy deployment.

## Prerequisites

1. **Unraid 6.8+** with Docker support enabled
2. **Calibre-Web-Automated** already installed and running
3. **Calibre Library** with metadata.db accessible to Unraid

## Quick Start

### Method 1: Unraid Template (Recommended)

1. **Add Template Repository**:
   - Go to **Docker** tab in Unraid
   - Click **Add Container**
   - In the template dropdown, select **Add Template**
   - Add this URL: `https://raw.githubusercontent.com/your-username/calibre-web-automated-book-downloader/main/unraid-template.xml`

2. **Install from Template**:
   - Search for "CWA Book Downloader"
   - Click the template and configure the required settings
   - Click **Apply** to create the container

### Method 2: Manual Docker Setup

1. **Download Files**:
   ```bash
   wget https://raw.githubusercontent.com/your-username/calibre-web-automated-book-downloader/main/docker-compose.unraid.yml
   wget https://raw.githubusercontent.com/your-username/calibre-web-automated-book-downloader/main/unraid.env.example
   ```

2. **Run Deployment Script**:
   ```bash
   chmod +x deploy-unraid.sh
   ./deploy-unraid.sh
   ```

3. **Configure Environment**:
   - Edit `/mnt/user/appdata/cwa-book-downloader/.env`
   - Set your CWA connection details and paths

4. **Start Container**:
   ```bash
   cd /mnt/user/appdata/cwa-book-downloader
   docker-compose up -d
   ```

## Configuration

### Required Settings

| Setting | Description | Example |
|---------|-------------|---------|
| `CWA_BASE_URL` | URL of your CWA instance | `http://192.168.1.100:8083` |
| `CWA_USERNAME` | CWA admin username | `admin` |
| `CWA_PASSWORD` | CWA admin password | `your-password` |

### Volume Mappings

| Container Path | Host Path | Description |
|----------------|-----------|-------------|
| `/config` | `/mnt/user/appdata/calibre-web/config` | CWA config (contains app.db) |
| `/calibre-library` | `/mnt/user/media/books/calibre-library` | Calibre library directory |
| `/ingest` | `/mnt/user/media/books/ingest` | Book ingest directory |
| `/app/data` | `/mnt/user/appdata/cwa-book-downloader/data` | App data |
| `/logs` | `/mnt/user/appdata/cwa-book-downloader/logs` | Application logs |

### Port Configuration

| Port | Description |
|------|-------------|
| `8084` | Web interface port |

## Environment Variables

### Authentication
- `CWA_DB_PATH=/config/app.db` - Path to CWA's authentication database
- `DISABLE_AUTH=false` - Disable authentication (NOT recommended)

### Download Settings
- `BOOK_LANGUAGE=en` - Default book language
- `USE_BOOK_TITLE=true` - Include book title in filename
- `MAX_CONCURRENT_DOWNLOADS=3` - Maximum concurrent downloads
- `AA_DONATOR_KEY=` - Anna's Archive donator key (optional)

### Network Settings
- `USE_CF_BYPASS=true` - Enable Cloudflare bypass
- `HTTP_PROXY=` - HTTP proxy URL (optional)
- `HTTPS_PROXY=` - HTTPS proxy URL (optional)

### System Settings
- `TZ=America/New_York` - Container timezone
- `PUID=1000` - User ID for file permissions
- `PGID=1000` - Group ID for file permissions
- `LOG_LEVEL=INFO` - Log level (DEBUG, INFO, WARNING, ERROR)

## Directory Structure

```
/mnt/user/appdata/cwa-book-downloader/
├── .env                    # Environment configuration
├── docker-compose.yml     # Docker Compose configuration
├── data/                  # Application data
└── logs/                  # Application logs

/mnt/user/appdata/calibre-web/config/
├── app.db                 # CWA authentication database
└── ...                    # Other CWA config files

/mnt/user/media/books/
├── calibre-library/       # Calibre library
│   ├── metadata.db        # Calibre database
│   └── Author Name/       # Book directories
├── ingest/                # Book ingest directory
└── ...
```

## Accessing the Application

1. **Web Interface**: `http://YOUR_UNRAID_IP:8084`
2. **Login**: Use your CWA admin credentials
3. **Features**:
   - Modern React-based interface
   - Book search and download
   - Download queue management
   - Library browsing
   - Real-time progress tracking

## Troubleshooting

### Authentication Issues

**Problem**: Getting 401 Unauthorized errors
**Solutions**:
- Verify `CWA_DB_PATH` points to the correct app.db file
- Check that the config directory is properly mounted
- Ensure CWA credentials are correct
- Check container logs: `docker logs cwa-book-downloader`

### Library Not Loading

**Problem**: Books don't appear in the library view
**Solutions**:
- Verify Calibre library path contains `metadata.db`
- Check file permissions on library directory
- Ensure library directory is mounted correctly
- Test with: `ls -la /mnt/user/media/books/calibre-library/`

### Download Issues

**Problem**: Downloads fail or don't start
**Solutions**:
- Verify CWA_BASE_URL is accessible from the container
- Check CWA username/password
- Ensure ingest directory is writable
- Check network connectivity to Anna's Archive

### Container Won't Start

**Problem**: Container fails to start
**Solutions**:
- Check Docker logs: `docker logs cwa-book-downloader`
- Verify all required environment variables are set
- Check that all volume paths exist and are accessible
- Ensure no port conflicts (8084 not already in use)

## Health Monitoring

The container includes a health check that monitors the application status:
- **Endpoint**: `http://localhost:8084/api/status`
- **Interval**: 30 seconds
- **Timeout**: 10 seconds
- **Retries**: 3

Monitor health in Unraid Docker tab or with:
```bash
docker ps  # Check health status
docker logs cwa-book-downloader  # View logs
```

## Performance Tuning

### Resource Limits
Configure in your `.env` file:
```bash
MEMORY_LIMIT=2G
MEMORY_RESERVATION=512M
CPU_LIMIT=2.0
CPU_RESERVATION=0.5
```

### Download Optimization
- Increase `MAX_CONCURRENT_DOWNLOADS` for faster downloading (if bandwidth allows)
- Set `AA_DONATOR_KEY` for priority access to Anna's Archive
- Use `USE_CF_BYPASS=true` to bypass Cloudflare protection

## Updates

To update the container:
1. Pull the latest image: `docker pull ghcr.io/your-username/cwa-book-downloader:latest`
2. Restart the container: `docker-compose restart`
3. Or use Unraid's Docker tab to update

## Security Considerations

1. **Authentication**: Never set `DISABLE_AUTH=true` in production
2. **Network**: Consider using a reverse proxy with SSL
3. **Permissions**: Use appropriate PUID/PGID for your system
4. **Backups**: Regularly backup your configuration and data directories

## Support

- **Documentation**: [GitHub Repository](https://github.com/your-username/calibre-web-automated-book-downloader)
- **Issues**: [GitHub Issues](https://github.com/your-username/calibre-web-automated-book-downloader/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-username/calibre-web-automated-book-downloader/discussions)

## License

This project is licensed under the same license as Calibre-Web-Automated.
