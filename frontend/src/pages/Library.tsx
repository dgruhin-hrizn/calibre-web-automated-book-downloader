import { useState, useEffect } from 'react'
import { Search, Filter, Download, Book, Grid, List, User, Tag, Send, Star } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { UnifiedBookCard, type UnifiedBook } from '../components/UnifiedBookCard'
import { apiRequest } from '../lib/utils'
import { formatDate } from '../lib/utils'
import { imageCache } from '../lib/imageCache'
import { useToast } from '../hooks/useToast'

interface LibraryBook {
  id: number
  title: string
  authors: string[]
  series?: string
  series_index?: number
  rating?: number
  pubdate?: string
  timestamp?: string
  tags: string[]
  languages: string[]
  formats: string[]
  path: string
  has_cover: boolean
  comments?: string
}

interface CWALibraryResponse {
  totalNotFiltered: number
  total: number
  rows: any[]  // Raw CWA book objects
}



interface LibraryStats {
  total_books: number
  total_authors: number
  total_series: number
  total_tags: number
}

export function Library() {
  const { showToast, ToastContainer } = useToast()
  const [books, setBooks] = useState<LibraryBook[]>([])
  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [sortParam, setSortParam] = useState('new') // Use CWA sort_param values


  const [selectedBook, setSelectedBook] = useState<LibraryBook | null>(null)
  const [error, setError] = useState<string | null>(null)
  
  // Image loading queue management
  const [imageLoadQueue, setImageLoadQueue] = useState<number[]>([])
  const [loadedImages, setLoadedImages] = useState<Set<number>>(new Set())
  const [currentlyLoadingImages, setCurrentlyLoadingImages] = useState<Set<number>>(new Set())
  
  // Concurrent loading settings - based on CWA source analysis:
  // Cover endpoints (/cover/<id>) are in 'web' blueprint with NO rate limits
  // But being conservative to avoid overwhelming the server/filesystem
  const MAX_CONCURRENT_IMAGES = 4 // Load up to 4 images simultaneously
  
  const perPage = viewMode === 'grid' ? 18 : 18
  
  // Concurrent image loading effect
  useEffect(() => {
    if (imageLoadQueue.length === 0) return
    
    // Find images that should be loading but aren't yet
    const imagesToLoad = imageLoadQueue
      .filter(id => !loadedImages.has(id) && !currentlyLoadingImages.has(id))
      .slice(0, MAX_CONCURRENT_IMAGES - currentlyLoadingImages.size)
    
    if (imagesToLoad.length > 0) {
      setCurrentlyLoadingImages(prev => new Set([...prev, ...imagesToLoad]))

    }
  }, [imageLoadQueue, loadedImages, currentlyLoadingImages, MAX_CONCURRENT_IMAGES])
  
  // Function to mark an image as loaded and trigger next load
  const markImageLoaded = (bookId: number) => {

    setLoadedImages(prev => new Set([...prev, bookId]))
    setCurrentlyLoadingImages(prev => {
      const newSet = new Set(prev)
      newSet.delete(bookId)
      return newSet
    })
  }
  
  // Function to check if an image should load
  const shouldLoadImage = (bookId: number) => {
    return currentlyLoadingImages.has(bookId) || loadedImages.has(bookId)
  }

  // Load library books
  const loadBooks = async (page = 1, search = '', sortParam = 'new') => {
    try {
      setLoading(true)
      setError(null)
      
      // Use regular library endpoint with limited sorting
      // Map CWA sort_param to sort/order for the AJAX endpoint
      // Based on /ajax/listbooks logic in cwa-reference/cps/web.py lines 918-942
      const getSortOrder = (param: string) => {
        switch (param) {
          // For timestamp sorting, use default behavior (falls through to timestamp.desc())
          case 'new': return { sort: 'timestamp', order: '' } // Let it default to timestamp.desc()
          case 'old': return { sort: 'timestamp', order: '' } // This won't work as expected, timestamp is always desc by default
          // Title sorting - use 'sort' field (line 939)
          case 'abc': return { sort: 'sort', order: 'asc' }
          case 'zyx': return { sort: 'sort', order: 'desc' }
          // Author sorting - use 'authors' (lines 929-933) or 'author_sort' (lines 934-935)
          case 'authaz': return { sort: 'author_sort', order: 'asc' }
          case 'authza': return { sort: 'author_sort', order: 'desc' }
          // Publication date - NOT supported by /ajax/listbooks, fallback to default
          case 'pubnew': return { sort: 'timestamp', order: '' }
          case 'pubold': return { sort: 'timestamp', order: '' }
          // Series sorting
          case 'seriesasc': return { sort: 'series_index', order: 'asc' }
          case 'seriesdesc': return { sort: 'series_index', order: 'desc' }
          default: return { sort: 'timestamp', order: '' }
        }
      }
      
      const { sort, order } = getSortOrder(sortParam)
      
      const params = new URLSearchParams({
        offset: ((page - 1) * perPage).toString(),
        limit: perPage.toString(),
        sort: sort,
        order: order,
        ...(search && { search: search })
      })
      
      const response: CWALibraryResponse = await apiRequest(`/api/cwa/library/books?${params}`)
      
      // Check if we got HTML (login page) instead of JSON
      if (typeof response === 'string') {
        const responseStr = response as string
        if (responseStr.includes('<!DOCTYPE html>')) {
          throw new Error('Got HTML response from CWA - likely authentication failed')
        }
        throw new Error(`Got string response from CWA instead of JSON: ${responseStr.substring(0, 100)}`)
      }
      
      if (!response || typeof response !== 'object') {
        throw new Error(`Invalid response format from CWA. Got: ${typeof response}`)
      }
      
      // Debug: Log basic response info

      
      // Transform CWA response to our format
      const transformedBooks: LibraryBook[] = (response.rows || []).map((book: any) => {
        // Helper to split comma-separated strings (CWA format)
        const splitCommaString = (str: string | undefined | null) => {
          if (!str) return []
          return str.split(',').map(s => s.trim()).filter(Boolean)
        }

        // CWA's /ajax/listbooks doesn't include detailed format info, so we start with empty
        // formats and fetch them individually after loading the page
        let formats: string[] = [] // Will be populated by fetchFormatsForBooks()

        return {
          id: book?.id || 0,
          title: book?.title || 'Unknown Title',
          authors: book?.authors ? splitCommaString(book.authors) : [],
          series: book?.series || undefined,
          series_index: book?.series_index ? parseFloat(book.series_index) : undefined,
          rating: book?.ratings || book?.rating || undefined,
          pubdate: book?.pubdate || undefined,
          timestamp: book?.timestamp || book?.atom_timestamp || undefined,
          tags: book?.tags ? splitCommaString(book.tags) : [],
          languages: book?.languages ? splitCommaString(book.languages) : [],
          formats: formats,
          path: book?.path || '',
          has_cover: book?.has_cover === 1,
          comments: book?.comments || undefined
        }
      })
      
      setBooks(transformedBooks)
      setCurrentPage(page)
      setTotalPages(Math.ceil(response.total / perPage))
      
      // Initialize image loading queue in display order
      const booksWithCovers = transformedBooks
        .filter(book => book.has_cover)
        .map(book => book.id)
      
      setImageLoadQueue(booksWithCovers)
      setLoadedImages(new Set())
      setCurrentlyLoadingImages(new Set())
      

      
      // Preload the first few images for instant display (reduced to avoid API overload)
      const preloadUrls = transformedBooks
        .slice(0, 4) // Preload first 4 images only
        .filter(book => book.has_cover)
        .map(book => `/api/cwa/library/books/${book.id}/cover/md`)
      
      if (preloadUrls.length > 0) {
        imageCache.preloadImages(preloadUrls)
      }
      
      // Fetch format information for all books on this page
      fetchFormatsForBooks(transformedBooks)
      
    } catch (error) {
      console.error('Failed to load library books:', error)
      setError('Failed to load library books. Make sure your CWA instance is running.')
    } finally {
      setLoading(false)
    }
  }

  // Test CWA connection first
  const testCWAConnection = async () => {
    try {
      const response = await apiRequest('/api/cwa/health')

      return response.status === 'ok'
    } catch (error) {
      console.error('CWA health check failed:', error)
      // Also try the proxied health check
      try {
        const proxyResponse = await apiRequest('/api/cwa/health-proxy')

        return proxyResponse.status === 'ok'
      } catch (proxyError) {
        console.error('CWA proxy health check also failed:', proxyError)
        return false
      }
    }
  }

  // Load library statistics using endpoints available to all users
  const loadStats = async () => {

    try {
      // Load stats using endpoints available to all users
      const [authorsResponse, seriesResponse, tagsResponse, booksResponse] = await Promise.all([
        apiRequest('/api/cwa/authors').then(response => {
          // CWA returns JSON as a string, so we need to parse it
          return typeof response === 'string' ? JSON.parse(response) : response
        }).catch(() => []),
        apiRequest('/api/cwa/series').then(response => {
          return typeof response === 'string' ? JSON.parse(response) : response
        }).catch(() => []),
        apiRequest('/api/cwa/tags').then(response => {
          return typeof response === 'string' ? JSON.parse(response) : response
        }).catch(() => []),
        apiRequest('/api/cwa/library/books?length=1').catch(() => ({ total: 0 })) // Just get total count
      ])



      setStats({
        total_books: booksResponse.total || booksResponse.totalNotFiltered || 0,
        total_authors: Array.isArray(authorsResponse) ? authorsResponse.length : 0,
        total_series: Array.isArray(seriesResponse) ? seriesResponse.length : 0,
        total_tags: Array.isArray(tagsResponse) ? tagsResponse.length : 0
      })
    } catch (error) {
      console.error('Failed to load library stats:', error)
      // Set basic stats from books response if available
      try {
        const booksResponse = await apiRequest('/api/cwa/library/books?length=1')
        setStats({
          total_books: booksResponse.total || booksResponse.totalNotFiltered || 0,
          total_authors: 0,
          total_series: 0,
          total_tags: 0
        })
      } catch (fallbackError) {
        console.error('Failed to load basic stats:', fallbackError)
      }
    }
  }

  // Initial load
  useEffect(() => {
    const initialize = async () => {

      
      // Test CWA connection first
      const isHealthy = await testCWAConnection()

      
      if (!isHealthy) {
        setError('CWA health check failed. Please ensure your CWA instance is running and accessible.')
        setLoading(false)
        return
      }
      
      // If healthy, load data

      loadBooks(1, '', sortParam)
      

      loadStats()
    }
    
    initialize()
  }, [])

  // Handle search
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setCurrentPage(1)
    loadBooks(1, searchQuery, sortParam)
  }

  // Handle page change
  const handlePageChange = (page: number) => {
    loadBooks(page, searchQuery, sortParam)
  }

  // Handle sort change
  const handleSortChange = (newSortParam: string) => {
    setSortParam(newSortParam)
    setCurrentPage(1)
    loadBooks(1, searchQuery, newSortParam)
  }

  // Fetch actual formats for a book
  const fetchBookFormats = async (bookId: number): Promise<string[]> => {
    try {
      const response = await apiRequest(`/api/cwa/library/books/${bookId}/details`)
      return response.formats || ['EPUB', 'PDF']
    } catch (error) {
      console.error('Failed to fetch book formats:', error)
      return ['EPUB', 'PDF'] // Fallback to common formats
    }
  }

  // Fetch formats for multiple books and update the books state
  const fetchFormatsForBooks = async (booksToUpdate: LibraryBook[]) => {
    // Process books in batches to avoid overwhelming the server
    const batchSize = 3 // Process 3 books at a time
    const batches = []
    
    for (let i = 0; i < booksToUpdate.length; i += batchSize) {
      batches.push(booksToUpdate.slice(i, i + batchSize))
    }
    
    for (const batch of batches) {
      // Process each batch concurrently
      const formatPromises = batch.map(async (book) => {
        try {
          const formats = await fetchBookFormats(book.id)
          return { bookId: book.id, formats }
        } catch (error) {
          console.error(`Failed to fetch formats for book ${book.id}:`, error)
          return { bookId: book.id, formats: [] } // Empty formats will hide buttons
        }
      })
      
      const results = await Promise.all(formatPromises)
      
      // Update books state with the fetched formats
      setBooks(prevBooks => 
        prevBooks.map(book => {
          const result = results.find(r => r.bookId === book.id)
          if (result) {
            return { ...book, formats: result.formats }
          }
          return book
        })
      )
      

      
      // Small delay between batches to be gentle on the server
      if (batches.indexOf(batch) < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
    

  }

  // Download book from CWA library
  const downloadBook = async (book: LibraryBook, format?: string) => {
    try {
      // If no format specified, get the actual formats and use the first one
      let downloadFormat = format
      if (!downloadFormat) {
        const actualFormats = await fetchBookFormats(book.id)
        downloadFormat = actualFormats[0] || 'EPUB'
      }
      
      const response = await fetch(`/api/cwa/library/books/${book.id}/download/${downloadFormat}`, {
        credentials: 'include'
      })
      
      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${book.title}.${downloadFormat.toLowerCase()}`
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)

      } else {
        console.error('Failed to download from CWA library')
      }
    } catch (error) {
      console.error('Error downloading from CWA library:', error)
    }
  }

  // Send book to Kindle
  const sendToKindle = async (book: LibraryBook, _format?: string) => {
    try {
      // Get actual available formats
      const actualFormats = await fetchBookFormats(book.id)
      
      // For Kindle, we only send EPUB format and let CWA handle the conversion
      // This matches CWA's recommended approach for Kindle delivery
      const lowerFormats = actualFormats.map(f => f.toLowerCase())
      
      if (!lowerFormats.includes('epub')) {
        console.error('No EPUB format available for Kindle delivery')
        showToast({
          type: 'error',
          title: 'Cannot Send to Kindle',
          message: `"${book.title}" does not have an EPUB format available for Kindle delivery.`
        })
        return
      }
      
      // Always use EPUB format with no conversion
      const sendFormat = 'epub'
      const convert = 0 // No conversion - send EPUB as-is
      
      const response = await apiRequest(`/api/cwa/library/books/${book.id}/send/${sendFormat}/${convert}`, {
        method: 'POST'
      })
      
      if (Array.isArray(response) && response.length > 0) {
        const result = response[0]
        if (result.type === 'success') {
          console.log('Book sent to Kindle successfully:', book.title, 'as EPUB (no conversion)')
          showToast({
            type: 'success',
            title: 'Book Sent to Kindle!',
            message: `"${book.title}" has been queued for delivery to your Kindle.`
          })
        } else {
          console.error('Failed to send book to Kindle:', result.message)
          showToast({
            type: 'error',
            title: 'Send to Kindle Failed',
            message: result.message || 'Unknown error occurred'
          })
        }
      }
    } catch (error) {
      console.error('Error sending book to Kindle:', error)
      showToast({
        type: 'error',
        title: 'Send to Kindle Error',
        message: error instanceof Error ? error.message : 'An unexpected error occurred'
      })
    }
  }

  if (error) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Library</h1>
          <p className="text-muted-foreground">Browse your CWA library collection</p>
        </div>
        
        <Card>
          <CardContent className="p-6">
            <div className="text-center text-red-600">
              <p className="font-medium">Connection Error</p>
              <p className="text-sm mt-1">{error}</p>
              <Button 
                onClick={() => loadBooks()} 
                className="mt-4"
                variant="outline"
              >
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Library</h1>
        <p className="text-muted-foreground">Browse your CWA library collection</p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Books</p>
                  <p className="text-2xl font-bold">{stats.total_books.toLocaleString()}</p>
                </div>
                <Book className="h-8 w-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Authors</p>
                  <p className="text-2xl font-bold">{stats.total_authors.toLocaleString()}</p>
                </div>
                <User className="h-8 w-8 text-green-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Series</p>
                  <p className="text-2xl font-bold">{stats.total_series.toLocaleString()}</p>
                </div>
                <Tag className="h-8 w-8 text-purple-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Tags</p>
                  <p className="text-2xl font-bold">{stats.total_tags.toLocaleString()}</p>
                </div>
                <Filter className="h-8 w-8 text-orange-600" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search and Controls */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search */}
            <form onSubmit={handleSearch} className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <input
                  type="text"
                  placeholder="Search your library..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </form>
            
            {/* Sort */}
            <select
              value={sortParam}
              onChange={(e) => handleSortChange(e.target.value)}
              className="px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="new">Recently Added</option>
              <option value="abc">Title A-Z</option>
              <option value="zyx">Title Z-A</option>
              <option value="authaz">Author A-Z</option>
              <option value="authza">Author Z-A</option>
              <option value="seriesasc">Series Index ↑</option>
              <option value="seriesdesc">Series Index ↓</option>
            </select>
            
            {/* View Mode */}
            <div className="flex rounded-md border border-input">
              <Button
                variant={viewMode === 'grid' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('grid')}
                className="rounded-r-none"
              >
                <Grid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('list')}
                className="rounded-l-none"
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Books Grid/List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : !books || books.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Book className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">No books found</p>
            <p className="text-muted-foreground">Try adjusting your search or filters</p>
          </CardContent>
        </Card>
      ) : (
        <div className={viewMode === 'grid' 
          ? "grid gap-4 grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
          : "space-y-4"
        }>
          {books?.map((book) => (
            <UnifiedBookCard
              key={book.id}
              book={book as UnifiedBook}
              cardType="library"
              viewMode={viewMode}
              onSendToKindle={(_unifiedBook) => sendToKindle(book)}
              onDetails={(_unifiedBook) => setSelectedBook(book)}
              shouldLoadImage={(_bookId) => shouldLoadImage(book.id)}
              onImageLoaded={(_bookId) => markImageLoaded(book.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
          >
            Previous
          </Button>
          
          <div className="flex items-center gap-2">
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const page = currentPage <= 3 ? i + 1 : currentPage - 2 + i
              if (page > totalPages) return null
              
              return (
                <Button
                  key={page}
                  variant={currentPage === page ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handlePageChange(page)}
                >
                  {page}
                </Button>
              )
            })}
          </div>
          
          <Button
            variant="outline"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            Next
          </Button>
        </div>
      )}

      {/* Book Details Modal */}
      {selectedBook && (
        <BookDetailsModal
          book={selectedBook}
          onClose={() => setSelectedBook(null)}
          onDownload={downloadBook}
          onSendToKindle={sendToKindle}
        />
      )}
      
      {/* Toast Notifications */}
      <ToastContainer />
    </div>
  )
}



// Book Details Modal Component
interface BookDetailsModalProps {
  book: LibraryBook
  onClose: () => void
  onDownload: (book: LibraryBook, format?: string) => void
  onSendToKindle: (book: LibraryBook) => void
}

function BookDetailsModal({ book, onClose, onDownload, onSendToKindle }: BookDetailsModalProps) {
  const coverUrl = book.has_cover ? `/api/cwa/library/books/${book.id}/cover` : null
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <Card className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <div className="flex justify-between items-start">
            <CardTitle className="text-xl">{book.title}</CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose}>
              ×
            </Button>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-6">
          <div className="flex gap-6">
            {/* Cover */}
            <div className="w-32 h-48 bg-muted rounded overflow-hidden flex-shrink-0">
              {coverUrl ? (
                <img 
                  src={coverUrl} 
                  alt={book.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Book className="h-12 w-12 text-muted-foreground" />
                </div>
              )}
            </div>
            
            {/* Details */}
            <div className="flex-1 space-y-4">
              <div>
                <h3 className="font-medium text-lg">{book.title}</h3>
                <p className="text-muted-foreground">{book.authors.join(', ')}</p>
              </div>
              
              {book.series && (
                <div>
                  <span className="text-sm font-medium">Series: </span>
                  <span className="text-sm">{book.series} #{book.series_index}</span>
                </div>
              )}
              
              {book.pubdate && (
                <div>
                  <span className="text-sm font-medium">Published: </span>
                  <span className="text-sm">{formatDate(book.pubdate)}</span>
                </div>
              )}
              
              {book.rating && (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Rating: </span>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 5 }, (_, i) => (
                      <Star
                        key={i}
                        className={`h-4 w-4 ${
                          i < Math.floor(book.rating! / 2) 
                            ? 'text-yellow-400 fill-current' 
                            : 'text-gray-300'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )}
              
              {/* Tags */}
              {book.tags.length > 0 && (
                <div>
                  <span className="text-sm font-medium">Tags: </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {book.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Download and Send Actions */}
              {book.formats.length > 0 ? (
                <div className="space-y-4">
                  <div>
                    <span className="text-sm font-medium">Download: </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onDownload(book)}
                      className="ml-2"
                    >
                      <Download className="h-3 w-3 mr-1" />
                      Best Format
                    </Button>
                    <p className="text-xs text-muted-foreground mt-1">
                      Automatically selects the best available format
                    </p>
                  </div>
                  
                  <div>
                    <Button
                      onClick={() => onSendToKindle(book)}
                      className="w-full sm:w-auto"
                    >
                      <Send className="h-4 w-4 mr-2" />
                      Send to Kindle
                    </Button>
                    <p className="text-xs text-muted-foreground mt-1">
                      Automatically converts to best Kindle format and emails to your device
                    </p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground">Loading available formats...</p>
                </div>
              )}
            </div>
          </div>
          
          {/* Description */}
          {book.comments && (
            <div>
              <h4 className="font-medium mb-2">Description</h4>
              <div 
                className="text-sm text-muted-foreground prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: book.comments }}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default Library
