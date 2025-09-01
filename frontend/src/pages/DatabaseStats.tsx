import React, { useState, useEffect } from 'react'
import { RefreshCw, Database, Book, Users, Tag, TrendingUp, Search, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { UnifiedBookCard } from '../components/UnifiedBookCard'
import { useToast } from '../hooks/useToast'

interface DatabaseStats {
  total_books: number
  books_with_covers: number
  total_authors: number
  total_tags: number
  coverage_percentage: number
}

interface DatabaseBook {
  id: number
  title: string
  has_cover: boolean
  path: string
  authors: string[]
}

interface DatabaseResponse {
  books: DatabaseBook[]
  count: number
  limit: number
  offset: number
  search_term: string
}

export function DatabaseStats() {
  const { showToast, ToastContainer } = useToast()
  const [stats, setStats] = useState<DatabaseStats | null>(null)
  const [books, setBooks] = useState<DatabaseBook[]>([])
  const [loading, setLoading] = useState(true)
  const [booksLoading, setBooksLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)

  const BOOKS_PER_PAGE = 24

  // Fetch database statistics
  const fetchStats = async () => {
    try {
      const response = await fetch('/api/db/stats', {
        credentials: 'include'
      })
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const data = await response.json()
      setStats(data)
    } catch (error) {
      console.error('Error fetching database stats:', error)
      showToast({
        type: 'error',
        title: 'Database Error',
        message: error instanceof Error ? error.message : 'Failed to fetch database statistics'
      })
    }
  }

  // Fetch books from database
  const fetchBooks = async (offset = 0, search = '', append = false) => {
    try {
      if (!append) setBooksLoading(true)
      
      const params = new URLSearchParams({
        limit: BOOKS_PER_PAGE.toString(),
        offset: offset.toString()
      })
      
      if (search.trim()) {
        params.append('search', search.trim())
      }
      
      const response = await fetch(`/api/db/books?${params}`, {
        credentials: 'include'
      })
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const data: DatabaseResponse = await response.json()
      
      if (append) {
        setBooks(prev => [...prev, ...data.books])
      } else {
        setBooks(data.books)
      }
      
      setHasMore(data.count === BOOKS_PER_PAGE)
      
    } catch (error) {
      console.error('Error fetching books:', error)
      showToast({
        type: 'error',
        title: 'Database Error',
        message: error instanceof Error ? error.message : 'Failed to fetch books'
      })
    } finally {
      setBooksLoading(false)
      setSearchLoading(false)
    }
  }

  // Refresh database copy
  const refreshDatabase = async () => {
    try {
      setRefreshing(true)
      
      const response = await fetch('/api/db/refresh', {
        method: 'POST',
        credentials: 'include'
      })
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      showToast({
        type: 'success',
        title: 'Database Refreshed',
        message: 'Database copy has been refreshed successfully'
      })
      
      // Refresh data after successful database refresh
      await Promise.all([fetchStats(), fetchBooks(0, searchTerm)])
      
    } catch (error) {
      console.error('Error refreshing database:', error)
      showToast({
        type: 'error',
        title: 'Refresh Failed',
        message: error instanceof Error ? error.message : 'Failed to refresh database'
      })
    } finally {
      setRefreshing(false)
    }
  }

  // Handle search
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    setSearchLoading(true)
    setCurrentPage(0)
    await fetchBooks(0, searchTerm)
  }

  // Load more books
  const loadMore = async () => {
    const nextOffset = (currentPage + 1) * BOOKS_PER_PAGE
    setCurrentPage(prev => prev + 1)
    await fetchBooks(nextOffset, searchTerm, true)
  }

  // Convert database book to unified book format
  const convertToUnifiedBook = (book: DatabaseBook) => ({
    id: book.id.toString(),
    title: book.title,
    authors: book.authors,
    has_cover: book.has_cover,
    path: book.path,
    formats: ['EPUB'], // Default format
    tags: [],
    series: undefined,
    series_index: undefined,
    rating: undefined,
    comments: undefined
  })

  // Initial data load
  useEffect(() => {
    const loadInitialData = async () => {
      setLoading(true)
      await Promise.all([fetchStats(), fetchBooks()])
      setLoading(false)
    }
    
    loadInitialData()
  }, [])

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground">Loading database statistics...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <ToastContainer />
      
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Database className="h-8 w-8" />
            Database Statistics
          </h1>
          <p className="text-muted-foreground mt-2">
            Direct access to your Calibre library database
          </p>
        </div>
        
        <Button
          onClick={refreshDatabase}
          disabled={refreshing}
          variant="outline"
          className="flex items-center gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing...' : 'Refresh Database'}
        </Button>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Books</CardTitle>
              <Book className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total_books.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">
                Books in your library
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">With Covers</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.books_with_covers.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">
                {stats.coverage_percentage.toFixed(1)}% coverage
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Authors</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total_authors.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">
                Unique authors
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Tags</CardTitle>
              <Tag className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total_tags.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">
                Categories & genres
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search Section */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Search Books
          </CardTitle>
          <CardDescription>
            Search your library using direct database queries
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="flex gap-2">
            <Input
              type="text"
              placeholder="Search by title or author..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={searchLoading}>
              {searchLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Books Grid */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Recent Books</CardTitle>
              <CardDescription>
                {searchTerm ? `Search results for "${searchTerm}"` : 'Latest books from your library'}
              </CardDescription>
            </div>
            {searchTerm && (
              <Badge variant="secondary" className="flex items-center gap-1">
                <Search className="h-3 w-3" />
                {searchTerm}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {booksLoading && books.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
                <p className="text-muted-foreground">Loading books...</p>
              </div>
            </div>
          ) : books.length === 0 ? (
            <div className="text-center py-12">
              <Book className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">
                {searchTerm ? 'No books found matching your search' : 'No books available'}
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-4 grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {books.map((book) => (
                  <UnifiedBookCard
                    key={book.id}
                    book={convertToUnifiedBook(book)}
                    cardType="library"
                    viewMode="grid"
                    onSendToKindle={() => {
                      showToast({
                        type: 'info',
                        title: 'Feature Not Available',
                        message: 'Send to Kindle not available for direct database access'
                      })
                    }}
                    onDetails={() => {
                      showToast({
                        type: 'info',
                        title: 'Book Details',
                        message: `${book.title} by ${book.authors.join(', ')}`
                      })
                    }}
                    shouldLoadImage={() => true}
                    onImageLoaded={() => {}}
                  />
                ))}
              </div>

              {/* Load More Button */}
              {hasMore && (
                <div className="flex justify-center mt-8">
                  <Button
                    onClick={loadMore}
                    disabled={booksLoading}
                    variant="outline"
                    className="flex items-center gap-2"
                  >
                    {booksLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <TrendingUp className="h-4 w-4" />
                    )}
                    {booksLoading ? 'Loading...' : 'Load More Books'}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
