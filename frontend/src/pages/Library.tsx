// Library page for browsing CWA (Calibre-Web-Automated) books

import React, { useState } from 'react';
import { Search, BookOpen, Download, Eye, Filter, Grid, List, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/input.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Card, CardContent } from '../components/ui/card.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select.tsx';
import { Alert, AlertDescription } from '../components/ui/alert.tsx';
import { BookCover } from '../components/ui/BookCover';
import { useLibraryManager, useLibraryPagination, useLibraryDownloadBook, type LibraryBook } from '../hooks/useLibrary';

export default function Library() {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');

  // Use our new library hooks
  const libraryManager = useLibraryManager();
  const pagination = useLibraryPagination(1, 25);
  const downloadBook = useLibraryDownloadBook();

  // Search handling
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    pagination.changeSearch(searchQuery);
  };

  const clearSearch = () => {
    setSearchQuery('');
    pagination.clearSearch();
  };

  // Book actions
  const handleDownload = async (book: LibraryBook, format: string) => {
    try {
      const blob = await downloadBook.mutateAsync({ bookId: book.id, format });
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${book.title}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
    }
  };

  // For now, just download EPUB format as we haven't implemented the web reader yet
  const handleRead = (book: LibraryBook) => {
    const epubFormat = book.formats.find(f => f.toLowerCase() === 'epub');
    if (epubFormat) {
      handleDownload(book, epubFormat);
    } else if (book.formats.length > 0) {
      handleDownload(book, book.formats[0]);
    }
  };

  // Loading and error states
  if (libraryManager.statusLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin" />
        <span className="ml-2">Connecting to library...</span>
      </div>
    );
  }

  if (!libraryManager.isAvailable) {
    return (
      <div className="max-w-2xl mx-auto mt-8">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Calibre library not available. Please ensure your Calibre library is properly configured and accessible.
            {libraryManager.libraryPath && ` Library path: ${libraryManager.libraryPath}`}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Library</h1>
          <p className="text-muted-foreground mt-1">
            Browse your Calibre library
            {pagination.total && ` • ${pagination.total} books`}
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant={viewMode === 'grid' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('grid')}
          >
            <Grid className="w-4 h-4" />
          </Button>
          <Button
            variant={viewMode === 'list' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('list')}
          >
            <List className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="p-4">
          <form onSubmit={handleSearch} className="flex gap-4 items-end">
            <div className="flex-1">
              <Input
                placeholder="Search books, authors, series..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full"
              />
            </div>
            
            <Button type="submit" disabled={pagination.isLoading}>
              {pagination.isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              Search
            </Button>
            
            {pagination.search && (
              <Button type="button" variant="outline" onClick={clearSearch}>
                Clear
              </Button>
            )}
          </form>
          
          <div className="flex gap-4 mt-4 pt-4 border-t">
            <Select value={pagination.sort} onValueChange={pagination.changeSort}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="id">Newest First</SelectItem>
                <SelectItem value="title">Title A-Z</SelectItem>
                <SelectItem value="author">Author A-Z</SelectItem>
                <SelectItem value="timestamp">Date Added</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={pagination.perPage.toString()} onValueChange={(value) => pagination.changePerPage(Number(value))}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25 per page</SelectItem>
                <SelectItem value="50">50 per page</SelectItem>
                <SelectItem value="100">100 per page</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Search Results Info */}
      {pagination.search && (
        <div className="text-sm text-muted-foreground">
          Found {pagination.total} results for "{pagination.search}"
        </div>
      )}

      {/* Books Grid/List */}
      {pagination.isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin" />
          <span className="ml-2">Loading books...</span>
        </div>
      ) : pagination.books && pagination.books.length > 0 ? (
        <div className={
          viewMode === 'grid' 
            ? "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6"
            : "space-y-4"
        }>
          {pagination.books.map((book) => (
            <BookCard 
              key={book.id} 
              book={book} 
              viewMode={viewMode}
              onDownload={handleDownload}
              onRead={handleRead}
              isDownloading={downloadBook.isPending}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <BookOpen className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No books found</h3>
          <p className="text-muted-foreground">
            {pagination.search ? 'Try adjusting your search terms' : 'Your library appears to be empty'}
          </p>
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            disabled={!pagination.hasPreviousPage}
            onClick={pagination.previousPage}
          >
            Previous
          </Button>
          
          <span className="text-sm text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          
          <Button
            variant="outline"
            disabled={!pagination.hasNextPage}
            onClick={pagination.nextPage}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

// Book Card Component
interface BookCardProps {
  book: LibraryBook;
  viewMode: 'grid' | 'list';
  onDownload: (book: LibraryBook, format: string) => void;
  onRead: (book: LibraryBook) => void;
  isDownloading: boolean;
}

function BookCard({ book, viewMode, onDownload, onRead, isDownloading }: BookCardProps) {
  if (viewMode === 'list') {
    return (
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex gap-4">
            <BookCover
              src={book.has_cover ? `/api/library/books/${book.id}/cover` : undefined}
              alt={book.title}
              className="w-16 h-24 flex-shrink-0"
            />
            
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-lg truncate">{book.title}</h3>
              <p className="text-muted-foreground truncate">{book.author}</p>
              
              {book.series && (
                <p className="text-sm text-muted-foreground mt-1">
                  {book.series}
                </p>
              )}
              
              {book.comments && (
                <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                  {book.comments}
                </p>
              )}
              
              <div className="flex items-center gap-2 mt-3">
                {book.formats.map((format) => (
                  <Badge key={format} variant="secondary" className="text-xs">
                    {format.toUpperCase()}
                  </Badge>
                ))}
              </div>
            </div>
            
            <div className="flex flex-col gap-2 flex-shrink-0">
              <Button
                size="sm"
                onClick={() => onRead(book)}
                className="w-20"
              >
                <Eye className="w-4 h-4 mr-1" />
                Read
              </Button>
              
              {book.formats.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onDownload(book, book.formats[0])}
                  disabled={isDownloading}
                  className="w-20"
                >
                  <Download className="w-4 h-4 mr-1" />
                  Download
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="hover:shadow-lg transition-shadow group">
      <CardContent className="p-4">
        <div className="aspect-[3/4] mb-3">
          <BookCover
            src={book.has_cover ? `/api/library/books/${book.id}/cover` : undefined}
            alt={book.title}
            className="w-full h-full"
          />
        </div>
        
        <h3 className="font-semibold text-sm line-clamp-2 mb-1">{book.title}</h3>
        <p className="text-xs text-muted-foreground truncate mb-2">{book.author}</p>
        
        {book.series && (
          <p className="text-xs text-muted-foreground mb-2">
            {book.series}
          </p>
        )}
        
        <div className="flex flex-wrap gap-1 mb-3">
          {book.formats.slice(0, 2).map((format) => (
            <Badge key={format} variant="secondary" className="text-xs">
              {format.toUpperCase()}
            </Badge>
          ))}
          {book.formats.length > 2 && (
            <Badge variant="secondary" className="text-xs">
              +{book.formats.length - 2}
            </Badge>
          )}
        </div>
        
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => onRead(book)}
            className="flex-1"
          >
            <Eye className="w-3 h-3 mr-1" />
            Read
          </Button>
          
          {book.formats.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onDownload(book, book.formats[0])}
              disabled={isDownloading}
            >
              <Download className="w-3 h-3" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
