import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useDownloadBook } from '../hooks/useDownloads'
import { Button } from './ui/Button'
import { useDownloadStore } from '../stores/downloadStore'
import { useNavigate } from 'react-router-dom'
import { BookCover } from './BookDetailsModal/BookCover'
import { MoreByAuthor } from './BookDetailsModal/MoreByAuthor'
import { ModalFooter } from './BookDetailsModal/ModalFooter'
import { EnhancedBookInfo } from './BookDetailsModal/EnhancedBookInfo'



interface BookDetailsModalProps {
  book: any | null  // Full book data from search results
  onClose: () => void
}

export function BookDetailsModal({ book: basicBook, onClose }: BookDetailsModalProps) {
  // No need for useBookInfo hook - we already have the book data!
  const downloadBook = useDownloadBook()
  const downloads = useDownloadStore((state) => state.downloads)
  const [isDownloading, setIsDownloading] = useState(false)
  const [googleBooksData, setGoogleBooksData] = useState<any>(null)
  const [detailedGoogleBooksData, setDetailedGoogleBooksData] = useState<any>(null)
  const [enhancedBook, setEnhancedBook] = useState<any>(null)
  const [isLoadingEnhanced, setIsLoadingEnhanced] = useState(false)

  const [authorBooks, setAuthorBooks] = useState<any[]>([])
  const [isLoadingAuthorBooks, setIsLoadingAuthorBooks] = useState(false)
  const navigate = useNavigate()

  // Helper function to convert text to title case
  const toTitleCase = (str: string) => {
    if (!str) return str
    return str.replace(/\w\S*/g, (txt) => 
      txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    )
  }

  // Use enhanced book data if available, otherwise fall back to basic book data
  const book = enhancedBook || basicBook

  // Reset enhanced data when book changes to prevent showing stale data
  useEffect(() => {
    if (basicBook) {
      console.log('BookDetailsModal: Book changed, resetting enhanced data')
      setEnhancedBook(null)
      setGoogleBooksData(null)
      setDetailedGoogleBooksData(null)
      setAuthorBooks([])
      setIsLoadingEnhanced(false)
    }
  }, [basicBook?.id])

  // Fetch enhanced book data (just Google Books) using the book data we already have
  useEffect(() => {
    const fetchEnhancedData = async () => {
      if (!basicBook || !basicBook.title) {
        console.log('BookDetailsModal: No basic book data available for enhanced data fetch')
        return
      }

      console.log('BookDetailsModal: Fetching Google Books data for:', basicBook.title, 'by', basicBook.author)
      setIsLoadingEnhanced(true)

      try {
        // Direct Google Books search using the title and author we already have
        const response = await fetch('http://localhost:8084/api/google-books/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            title: basicBook.title,
            author: basicBook.author || '',
            maxResults: 1
          })
        })

        if (response.ok) {
          const googleBooksData = await response.json()
          console.log('BookDetailsModal: Google Books data received:', googleBooksData)
          
          // Combine Anna's Archive data with Google Books data
          const combinedData = {
            ...basicBook,  // Anna's Archive data (format, size, preview, etc.)
            googleBooks: googleBooksData  // Google Books enhancement
          }
          
          setEnhancedBook(combinedData)
          setGoogleBooksData(googleBooksData)

          // Fetch more books by author using Google Books data
          const author = googleBooksData?.volumeInfo?.authors?.[0] || basicBook.author
          if (author) {
            fetchAuthorBooks(author)
          }
        } else {
          console.log('BookDetailsModal: Enhanced book details not available:', response.status)
          // Fallback to direct Google Books API if enhanced endpoint fails
          await fallbackToDirectGoogleBooks()
        }
      } catch (error) {
        console.error('BookDetailsModal: Error fetching enhanced book details:', error)
        // Fallback to direct Google Books API on error
        await fallbackToDirectGoogleBooks()
      } finally {
        setIsLoadingEnhanced(false)
      }
    }

    const fallbackToDirectGoogleBooks = async () => {
      if (!basicBook || !basicBook.title) return
      
      console.log('BookDetailsModal: Falling back to direct Google Books API')
      
      try {
        const response = await fetch('http://localhost:8084/api/google-books/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
                  body: JSON.stringify({
          title: basicBook.title,
          author: basicBook.author || ''
        })
        })

        if (response.ok) {
          const googleData = await response.json()
          console.log('BookDetailsModal: Fallback Google Books data received:', googleData)
          setGoogleBooksData(googleData)
          
          // Fetch detailed volume information using the volume ID
          if (googleData.id) {
            fetchDetailedVolumeInfo(googleData.id)
          }
          
          // Fetch more books by the same author
          const author = googleData?.volumeInfo?.authors?.[0] || basicBook.author
          if (author) {
            fetchAuthorBooks(author)
          }
        }
      } catch (error) {
        console.error('BookDetailsModal: Fallback Google Books API also failed:', error)
      }
    }

    fetchEnhancedData()
  }, [basicBook])

  // Fetch detailed volume information
  const fetchDetailedVolumeInfo = async (volumeId: string) => {
    console.log('BookDetailsModal: Fetching detailed volume info for ID:', volumeId)

    
    try {
      const response = await fetch(`http://localhost:8084/api/google-books/volume/${encodeURIComponent(volumeId)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include'
      })

      if (response.ok) {
        const detailedData = await response.json()
        console.log('BookDetailsModal: Detailed volume data received:', detailedData)
        setDetailedGoogleBooksData(detailedData)
      } else {
        console.error('BookDetailsModal: Detailed volume data failed:', response.status, response.statusText)
        const errorText = await response.text()
        console.error('BookDetailsModal: Error response:', errorText)
      }
    } catch (error) {
      console.error('BookDetailsModal: Error fetching detailed volume data:', error)
    }
  }

  // Fetch more books by author
  const fetchAuthorBooks = async (authorName: string) => {
    console.log('BookDetailsModal: Fetching more books by author:', authorName)
    setIsLoadingAuthorBooks(true)
    
    try {
      const response = await fetch('http://localhost:8084/api/google-books/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          title: '',
          author: authorName, // Properly search by author
          maxResults: 18 // Get more books for carousel pagination
        })
      })

      if (response.ok) {
        const searchResponse = await response.json()
        console.log('BookDetailsModal: Author books data received:', searchResponse)
        
        // Google Books API returns search results differently than single book
        if (searchResponse.items) {
          setAuthorBooks(searchResponse.items.slice(0, 6))
        } else if (Array.isArray(searchResponse)) {
          setAuthorBooks(searchResponse.slice(0, 6))
        }
      } else {
        console.log('BookDetailsModal: Author books search failed:', response.status)
      }
    } catch (error) {
      console.error('BookDetailsModal: Error fetching author books:', error)
    } finally {
      setIsLoadingAuthorBooks(false)
    }
  }

  const handleSearchByTitle = (title: string) => {
    onClose()
    navigate(`/search?q=${encodeURIComponent(title)}&fresh=true`)
  }

  const handleDownload = async () => {
    const downloadStatus = downloads[book?.id!]
    const hasRealProgress = downloadStatus && (
      downloadStatus.progress > 0 || 
      downloadStatus.status === 'completed' || 
      downloadStatus.status === 'error' ||
      downloadStatus.status === 'processing' ||
      downloadStatus.status === 'waiting'
    )
    const isPending = isDownloading || (downloadStatus && downloadStatus.status === 'downloading' && (downloadStatus.progress || 0) === 0)

    if (downloadStatus?.status === 'completed' || isPending || hasRealProgress) return
    
    // Close the modal immediately when download is clicked
    onClose()
    
    setIsDownloading(true)
    try {
      await downloadBook.mutateAsync({ id: book?.id!, title: book?.title || '', author: book?.author || '' })
    } catch (error) {
      console.error('Download failed:', error)
    } finally {
      setIsDownloading(false)
    }
  }

  // Helper function to get the best available Google Books data
  const getBestGoogleBooksData = () => {
    // Prefer detailed data when available, fallback to basic data
    return detailedGoogleBooksData || googleBooksData
  }

  if (!basicBook) return null

  const downloadStatus = downloads[basicBook.id]

  return (
    <div className="fixed top-0 left-0 right-0 bottom-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50" style={{ margin: 0 }}>
      <div className="bg-card border border-border rounded-lg shadow-lg max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col" style={{ margin: 0 }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex-1 mr-4">
            <h2 className="text-xl font-semibold text-foreground line-clamp-2">
              {toTitleCase(book?.title || 'Unknown Title')}
            </h2>
            {(getBestGoogleBooksData()?.volumeInfo?.authors?.[0] || book?.author) && (
              <p className="text-sm text-muted-foreground mt-1">
                by {getBestGoogleBooksData()?.volumeInfo?.authors?.[0] || book?.author}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="p-2 flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {book && (
            <div className="space-y-6">
              {/* Main Book Layout - Condensed */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {/* Cover */}
                <BookCover preview={book.preview} title={book.title || ''} />

                {/* Book Details - Enhanced with Anna's Archive + Google Books */}
                <div className="md:col-span-3 space-y-4">
                  {/* Enhanced Book Information combining Anna's Archive + Google Books */}
                  <EnhancedBookInfo 
                    book={book}
                    googleBooksData={getBestGoogleBooksData()}
                  />
                </div>
              </div>




              {/* More by Author Section */}
              <MoreByAuthor
                authorName={getBestGoogleBooksData()?.volumeInfo?.authors?.[0] || book.author}
                books={authorBooks}
                isLoading={isLoadingAuthorBooks}
                onSearchByTitle={handleSearchByTitle}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        {book && (
          <ModalFooter
            downloadStatus={downloadStatus}
            isDownloading={isDownloading}
            onDownload={handleDownload}
          />
        )}
      </div>
    </div>
  )
}
