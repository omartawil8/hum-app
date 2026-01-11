import React, { useState, useEffect, useRef } from 'react';
import { Mic, Music, Volume2, Clock, Share2, Bookmark, AlertCircle, ThumbsDown, X, Home, Send, Star, Info, CreditCard, ChevronDown, ChevronRight, LogOut, User, Eye, EyeOff } from 'lucide-react';
import hummingBirdIcon from './assets/humming-bird.png';
import sparkleIcon from './assets/sparkle.svg';
import wizardGuyIcon from './assets/Wizard_guy.png';
import avidListenerIcon from './assets/Avid_Listener.png';

// API base URL - use environment variable or default to localhost for development
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Log API URL for debugging (remove in production if needed)
console.log('🌐 API Base URL:', API_BASE_URL);

export default function HumApp() {
  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [hasResult, setHasResult] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [matchData, setMatchData] = useState(null);
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [savedSongs, setSavedSongs] = useState([]);
  const [showFeedback, setShowFeedback] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [isSendingFeedback, setIsSendingFeedback] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showGeneralFeedback, setShowGeneralFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [isSendingGeneralFeedback, setIsSendingGeneralFeedback] = useState(false);
  const [isClosingFeedback, setIsClosingFeedback] = useState(false);
  const [isClosingBookmarks, setIsClosingBookmarks] = useState(false);
  const [bookmarkAnimating, setBookmarkAnimating] = useState(false);
  const [isClosingResults, setIsClosingResults] = useState(false);
  const [isHomepageAnimating, setIsHomepageAnimating] = useState(false);
  const [showTips, setShowTips] = useState(false);
  const [isClosingTips, setIsClosingTips] = useState(false);
  const [recentSearches, setRecentSearches] = useState([]);
  const [showAllSearches, setShowAllSearches] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [isClosingUpgrade, setIsClosingUpgrade] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [searchCount, setSearchCount] = useState(0);
  const [isPro, setIsPro] = useState(false);
  const [userTier, setUserTier] = useState('free'); // 'free', 'avid', 'unlimited'
  const [showAvidInfo, setShowAvidInfo] = useState(false);
  const [showUnlimitedInfo, setShowUnlimitedInfo] = useState(false);
  const [outOfSearchesError, setOutOfSearchesError] = useState(false);
  const [hasUsedInitialSearches, setHasUsedInitialSearches] = useState(false);
  const [lyricsInput, setLyricsInput] = useState('');
  const [isSearchingLyrics, setIsSearchingLyrics] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState('');
  const [user, setUser] = useState(null);
  const [nickname, setNickname] = useState('');
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [nicknameInput, setNicknameInput] = useState('');
  const [anonymousSearchCount, setAnonymousSearchCount] = useState(0);
  const [isClosingAuth, setIsClosingAuth] = useState(false);
  const [welcomeMessage, setWelcomeMessage] = useState(null);
  const [showWelcome, setShowWelcome] = useState(false);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const userDropdownRef = useRef(null);
  const [showEmojiDropdown, setShowEmojiDropdown] = useState(false);
  const emojiDropdownRef = useRef(null);
  
  // Blob animation state
  const [blob1Pos, setBlob1Pos] = useState({ x: 0, y: 0, scale: 1, opacity: 0.2 });
  const [blob2Pos, setBlob2Pos] = useState({ x: 0, y: 0, scale: 1, opacity: 0.15 });
  const [blob3Pos, setBlob3Pos] = useState({ x: 0, y: 0, scale: 1, opacity: 0.18 });
  const animationFrameRef = useRef(null);
  const timeRef = useRef(0);
  
  const ANONYMOUS_SEARCH_LIMIT = 1; // 1 free search without login
  const FREE_SEARCH_LIMIT = 5; // Total free searches (1 anonymous + 4 authenticated)
  const AVID_LISTENER_LIMIT = 100; // 100 searches per month for $1 tier
  // Unlimited tier has no limit
  
  const defaultSearches = [
    { 
      song: "Creepin'", 
      artist: "21 Savage & The Weeknd", 
      time: "2m ago",
      albumArt: "https://i.scdn.co/image/ab67616d0000b2734c8f092adc59b4bf4212389d"
    },
    { 
      song: "I Will Always Love You", 
      artist: "Whitney Houston", 
      time: "1h ago",
      albumArt: "https://img.songfacts.com/calendar/19496.jpg"
    },
    { 
      song: "Blinding Lights", 
      artist: "The Weeknd", 
      time: "3h ago",
      albumArt: "https://i.scdn.co/image/ab67616d0000b2738863bc11d2aa12b54f5aeb36"
    }
  ];
  
  // Calculate relative time
  const getRelativeTime = (timestamp) => {
    const now = Date.now();
    const diff = now - timestamp;
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };
  
  const availableSongs = [
    { id: 'blinding_lights', title: 'Blinding Lights', artist: 'The Weeknd' },
    { id: 'shape_of_you', title: 'Shape of You', artist: 'Ed Sheeran' },
    { id: 'levitating', title: 'Levitating', artist: 'Dua Lipa' },
    { id: 'espresso', title: 'Espresso', artist: 'Sabrina Carpenter' },
    { id: 'not_like_us', title: 'Not Like Us', artist: 'Kendrick Lamar' },
    { id: 'a_bar_song', title: 'A Bar Song (Tipsy)', artist: 'Shaboozey' },
    { id: 'tell_ur_girlfriend', title: 'Tell Ur Girlfriend', artist: 'Lay Bankz' },
    { id: 'show_me_love', title: 'Show Me Love', artist: 'WizTheMc' },
  ];
  
  useEffect(() => {
    const saved = localStorage.getItem('hum-saved-songs');
    if (saved) {
      setSavedSongs(JSON.parse(saved));
    }
    
    // Only load from localStorage if user is NOT logged in
    // For logged-in users, wait for database data to avoid flash
    const token = localStorage.getItem('hum-auth-token');
    if (!token) {
    const searches = localStorage.getItem('hum-recent-searches');
    if (searches) {
        try {
          const parsedSearches = JSON.parse(searches);
          setRecentSearches(parsedSearches);
        } catch (e) {
          console.error('Error parsing recent searches from localStorage:', e);
        }
      }
    }

    // Check for payment success
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('payment');
    const sessionId = urlParams.get('session_id');
    if (paymentStatus === 'success' && sessionId) {
      handlePaymentSuccess(sessionId);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (paymentStatus === 'canceled') {
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
      alert('Payment was canceled. No charges were made.');
    }

    // Load authentication token and user
    // (token already declared above, reuse it)
    if (token) {
      checkAuthStatus(token);
    } else {
      // If not logged in, check anonymous search status from backend
      checkAnonymousStatus();
    }

    // Load search count and pro status
    const count = localStorage.getItem('hum-search-count');
    if (count) {
      setSearchCount(parseInt(count));
    }

    const proStatus = localStorage.getItem('hum-pro-status');
    if (proStatus === 'true') {
      setIsPro(true);
    }

    // Load user tier
    const tier = localStorage.getItem('hum-user-tier');
    if (tier) {
      setUserTier(tier);
      if (tier !== 'free') {
        setIsPro(true);
      }
    }

    // Load initial searches flag
    const initialSearchesUsed = localStorage.getItem('hum-initial-searches-used');
    if (initialSearchesUsed === 'true') {
      setHasUsedInitialSearches(true);
      
      // If initial searches are used, cap searchCount at 5
      if (parseInt(count) > FREE_SEARCH_LIMIT) {
        setSearchCount(FREE_SEARCH_LIMIT);
        localStorage.setItem('hum-search-count', FREE_SEARCH_LIMIT.toString());
      }
    }

    // Nickname will be loaded from API when user logs in
    
    // Debug log
    console.log('Pro Status:', proStatus, 'isPro:', isPro, 'searchCount:', searchCount, 'tier:', tier);
  }, []);

  const checkAuthStatus = async (token) => {
    try {
      console.log('🔐 [checkAuthStatus] Starting auth check...');
      const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      console.log('🔐 [checkAuthStatus] Response:', { authenticated: data.authenticated, hasUser: !!data.user, hasRecentSearches: !!(data.user?.recentSearches?.length) });
      
      if (data.authenticated) {
        setUser(data.user);
        setSearchCount(data.user.searchCount || 0);
        localStorage.setItem('hum-search-count', (data.user.searchCount || 0).toString());
        // Set tier from backend
        if (data.user.tier) {
          setUserTier(data.user.tier);
          localStorage.setItem('hum-user-tier', data.user.tier);
        } else {
          // Default to free if not set
          setUserTier('free');
          localStorage.setItem('hum-user-tier', 'free');
        }
        // Load user data from API
        if (data.user.nickname) {
          setNickname(data.user.nickname);
        }
        if (data.user.bookmarks && data.user.bookmarks.length > 0) {
          setSavedSongs(data.user.bookmarks);
        }
        console.log('📚 [checkAuthStatus] Recent searches check:', { 
          hasRecentSearches: !!(data.user.recentSearches?.length),
          count: data.user.recentSearches?.length || 0,
          raw: data.user.recentSearches 
        });
        if (data.user.recentSearches && data.user.recentSearches.length > 0) {
          console.log('📥 Raw recent searches from API:', data.user.recentSearches);
          // Transform database format to UI format
          const transformedSearches = data.user.recentSearches.map(search => {
            // Handle both database format (with result object) and UI format (direct properties)
            const song = search.result?.title || search.song || '';
            const artist = search.result?.artist || search.artist || '';
            const albumArt = search.result?.albumArt || search.albumArt || null;
            let timestamp = Date.now();
            
            if (search.timestamp) {
              if (typeof search.timestamp === 'string') {
                timestamp = new Date(search.timestamp).getTime();
              } else if (search.timestamp instanceof Date) {
                timestamp = search.timestamp.getTime();
              } else if (typeof search.timestamp === 'number') {
                timestamp = search.timestamp;
              }
            }
            
            return { song, artist, albumArt, timestamp };
          }).filter(search => {
            // Only filter out if both song AND artist are missing
            // Allow entries with just song or just artist to pass through
            const hasSong = search.song && search.song.trim().length > 0;
            const hasArtist = search.artist && search.artist.trim().length > 0;
            return hasSong || hasArtist; // Keep if at least one exists
          });
          
          console.log('✨ Transformed recent searches:', transformedSearches);
          
          if (transformedSearches.length > 0) {
            setRecentSearches(transformedSearches);
            // Also save to localStorage as backup
            localStorage.setItem('hum-recent-searches', JSON.stringify(transformedSearches));
          } else {
            console.warn('⚠️ All recent searches were filtered out - no valid entries');
            setRecentSearches([]);
          }
        } else {
          console.log('📭 No recent searches in database');
          // Don't clear localStorage immediately - might have old data to preserve
          // Only set empty if we're sure there's nothing
          setRecentSearches([]);
        }
      } else {
        localStorage.removeItem('hum-auth-token');
        // Check anonymous status if not authenticated
        checkAnonymousStatus();
      }
    } catch (error) {
      console.error('Auth check error:', error);
      localStorage.removeItem('hum-auth-token');
      checkAnonymousStatus();
    }
  };

  const checkAnonymousStatus = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/anonymous-status`);
      const data = await response.json();
      if (!data.hasAnonymousSearch) {
        // Backend says anonymous search was used
        setAnonymousSearchCount(ANONYMOUS_SEARCH_LIMIT);
        localStorage.setItem('hum-anonymous-search-count', ANONYMOUS_SEARCH_LIMIT.toString());
      } else {
        // Backend says anonymous search is available
        const localCount = localStorage.getItem('hum-anonymous-search-count');
        if (localCount) {
          setAnonymousSearchCount(parseInt(localCount));
        } else {
          setAnonymousSearchCount(0);
        }
      }
    } catch (error) {
      console.error('Anonymous status check error:', error);
      // Fallback to localStorage if backend check fails
      const anonCount = localStorage.getItem('hum-anonymous-search-count');
      if (anonCount) {
        setAnonymousSearchCount(parseInt(anonCount));
      }
    }
  };

  const handlePaymentSuccess = async (sessionId) => {
    try {
      const token = localStorage.getItem('hum-auth-token');
      if (!token) return;

      // Verify payment and upgrade account
      const verifyResponse = await fetch(`${API_BASE_URL}/api/payments/verify-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ sessionId })
      });

      const verifyData = await verifyResponse.json();
      
      if (verifyData.success) {
        // Refresh user data
        await checkAuthStatus(token);
        
        const tierName = verifyData.tier === 'avid' ? 'Avid Listener' : 'Eat, Breath, Music';
        const limit = verifyData.tier === 'avid' ? '100 searches/month' : 'unlimited searches';
        
        alert(`🎉 Welcome to ${tierName}! You now have ${limit}.`);
      } else {
        // Fallback: check payment status
        const response = await fetch(`${API_BASE_URL}/api/payments/status`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        const data = await response.json();
        
        if (data.hasActiveSubscription) {
          await checkAuthStatus(token);
          const tierName = data.tier === 'avid' ? 'Avid Listener' : 'Eat, Breath, Music';
          const limit = data.tier === 'avid' ? '100 searches/month' : 'unlimited searches';
          alert(`🎉 Welcome to ${tierName}! You now have ${limit}.`);
        }
      }
    } catch (error) {
      console.error('Payment success handling error:', error);
    }
  };

  const handlePayPalPayment = async (plan) => {
    const tier = plan === 'Avid Listener' ? 'avid' : 'unlimited';
    
    try {
      const token = localStorage.getItem('hum-auth-token');
      if (!token) {
        setShowAuthModal(true);
        handleCloseUpgrade();
        return;
      }

      // Create PayPal payment
        const response = await fetch(`${API_BASE_URL}/api/payments/create-paypal-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ plan: tier })
      });

      const data = await response.json();

      if (data.success && data.approvalUrl) {
        // Redirect to PayPal
        window.location.href = data.approvalUrl;
      } else {
        alert('Failed to start PayPal payment. Please try again.');
      }
    } catch (error) {
      console.error('PayPal payment error:', error);
      alert('Failed to process PayPal payment. Please try again.');
    }
  };

  const handleSignup = async () => {
    if (!authEmail || !authPassword) {
      setAuthError('Please enter email and password');
      return;
    }

    if (authPassword.length < 6) {
      setAuthError('Password must be at least 6 characters');
      return;
    }

    setIsAuthenticating(true);
    setAuthError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: authEmail,
          password: authPassword,
          usedAnonymousSearch: anonymousSearchCount > 0 // Tell backend if they used anonymous search
        })
      });

      const data = await response.json();

      if (data.success) {
        localStorage.setItem('hum-auth-token', data.token);
        setUser(data.user);
        // Set search count based on backend response (accounts for anonymous search)
        setSearchCount(data.user.searchCount || 0);
        // Set tier from backend (should be 'free' for new signups)
        if (data.user.tier) {
          setUserTier(data.user.tier);
          localStorage.setItem('hum-user-tier', data.user.tier);
        } else {
          // Default to free if not set
          setUserTier('free');
          localStorage.setItem('hum-user-tier', 'free');
        }
        // Load user data from API
        if (data.user.nickname) {
          setNickname(data.user.nickname);
        }
        if (data.user.bookmarks && data.user.bookmarks.length > 0) {
          setSavedSongs(data.user.bookmarks);
        }
        if (data.user.recentSearches && data.user.recentSearches.length > 0) {
          console.log('📥 Raw recent searches from API:', data.user.recentSearches);
          // Transform database format to UI format
          const transformedSearches = data.user.recentSearches.map(search => {
            // Handle both database format (with result object) and UI format (direct properties)
            const song = search.result?.title || search.song || '';
            const artist = search.result?.artist || search.artist || '';
            const albumArt = search.result?.albumArt || search.albumArt || null;
            let timestamp = Date.now();
            
            if (search.timestamp) {
              if (typeof search.timestamp === 'string') {
                timestamp = new Date(search.timestamp).getTime();
              } else if (search.timestamp instanceof Date) {
                timestamp = search.timestamp.getTime();
              } else if (typeof search.timestamp === 'number') {
                timestamp = search.timestamp;
              }
            }
            
            return { song, artist, albumArt, timestamp };
          }).filter(search => {
            // Only filter out if both song AND artist are missing
            // Allow entries with just song or just artist to pass through
            const hasSong = search.song && search.song.trim().length > 0;
            const hasArtist = search.artist && search.artist.trim().length > 0;
            return hasSong || hasArtist; // Keep if at least one exists
          });
          
          console.log('✨ Transformed recent searches:', transformedSearches);
          
          if (transformedSearches.length > 0) {
            setRecentSearches(transformedSearches);
            // Also save to localStorage as backup
            localStorage.setItem('hum-recent-searches', JSON.stringify(transformedSearches));
          } else {
            console.warn('⚠️ All recent searches were filtered out - no valid entries');
            setRecentSearches([]);
          }
        } else {
          console.log('📭 No recent searches in database');
          // Don't clear localStorage immediately - might have old data to preserve
          // Only set empty if we're sure there's nothing
          setRecentSearches([]);
        }
        
        // Don't clear anonymous search count - it's tracked on backend now
        setShowAuthModal(false);
        setAuthEmail('');
        setAuthPassword('');
        setAuthError('');
        
        // Show welcome message
        const remainingSearches = FREE_SEARCH_LIMIT - (data.user.searchCount || 0);
        const welcomeMessage = remainingSearches === 5 
          ? "🎉 Welcome to hüm! You have 5 free searches to discover your favorite songs!"
          : `🎉 Welcome to hüm! You have ${remainingSearches} more free searches to discover your favorite songs!`;
        
        // Create a cute welcome notification
        showWelcomeNotification(welcomeMessage);
      } else {
        setAuthError(data.error || 'Failed to create account');
      }
    } catch (error) {
      setAuthError('Failed to create account. Please try again.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleLogin = async () => {
    if (!authEmail || !authPassword) {
      setAuthError('Please enter email and password');
      return;
    }

    setIsAuthenticating(true);
    setAuthError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: authEmail,
          password: authPassword
        })
      });

      const data = await response.json();

      if (data.success) {
        localStorage.setItem('hum-auth-token', data.token);
        setUser(data.user);
        setSearchCount(data.user.searchCount || 0);
        // Set tier from backend
        if (data.user.tier) {
          setUserTier(data.user.tier);
          localStorage.setItem('hum-user-tier', data.user.tier);
        } else {
          // Default to free if not set
          setUserTier('free');
          localStorage.setItem('hum-user-tier', 'free');
        }
        // Load user data from API
        if (data.user.nickname) {
          setNickname(data.user.nickname);
        }
        if (data.user.bookmarks && data.user.bookmarks.length > 0) {
          setSavedSongs(data.user.bookmarks);
        }
        if (data.user.recentSearches && data.user.recentSearches.length > 0) {
          console.log('📥 Raw recent searches from API:', data.user.recentSearches);
          // Transform database format to UI format
          const transformedSearches = data.user.recentSearches.map(search => {
            // Handle both database format (with result object) and UI format (direct properties)
            const song = search.result?.title || search.song || '';
            const artist = search.result?.artist || search.artist || '';
            const albumArt = search.result?.albumArt || search.albumArt || null;
            let timestamp = Date.now();
            
            if (search.timestamp) {
              if (typeof search.timestamp === 'string') {
                timestamp = new Date(search.timestamp).getTime();
              } else if (search.timestamp instanceof Date) {
                timestamp = search.timestamp.getTime();
              } else if (typeof search.timestamp === 'number') {
                timestamp = search.timestamp;
              }
            }
            
            return { song, artist, albumArt, timestamp };
          }).filter(search => {
            // Only filter out if both song AND artist are missing
            // Allow entries with just song or just artist to pass through
            const hasSong = search.song && search.song.trim().length > 0;
            const hasArtist = search.artist && search.artist.trim().length > 0;
            return hasSong || hasArtist; // Keep if at least one exists
          });
          
          console.log('✨ Transformed recent searches:', transformedSearches);
          
          if (transformedSearches.length > 0) {
            setRecentSearches(transformedSearches);
            // Also save to localStorage as backup
            localStorage.setItem('hum-recent-searches', JSON.stringify(transformedSearches));
          } else {
            console.warn('⚠️ All recent searches were filtered out - no valid entries');
            setRecentSearches([]);
          }
        } else {
          console.log('📭 No recent searches in database');
          // Don't clear localStorage immediately - might have old data to preserve
          // Only set empty if we're sure there's nothing
          setRecentSearches([]);
        }
        setShowAuthModal(false);
        setAuthEmail('');
        setAuthPassword('');
        setAuthError('');
      } else {
        setAuthError(data.error || 'Invalid email or password');
      }
    } catch (error) {
      setAuthError('Failed to login. Please try again.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('hum-auth-token');
    setUser(null);
    setSearchCount(0);
    setNickname('');
    setSavedSongs([]);
    setRecentSearches([]);
    setShowUserDropdown(false); // Close dropdown on logout
    // Don't reset anonymousSearchCount - if they used it, it stays used
    // localStorage.removeItem('hum-anonymous-search-count'); // Keep this so they can't get another free search
    localStorage.removeItem('hum-search-count');
  };

  // Helper function to save bookmarks to API
  const saveBookmarksToAPI = async (bookmarks) => {
    if (!user) return; // Only save if logged in
    
    try {
      const token = localStorage.getItem('hum-auth-token');
      await fetch(`${API_BASE_URL}/api/user/bookmarks`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ bookmarks })
      });
    } catch (error) {
      console.error('Error saving bookmarks to API:', error);
      // Fallback to localStorage if API fails
      localStorage.setItem('hum-saved-songs', JSON.stringify(bookmarks));
    }
  };

  // Helper function to save recent searches to API
  const saveRecentSearchesToAPI = async (searches) => {
    if (!user) {
      console.log('💾 [saveRecentSearchesToAPI] Skipping - user not logged in');
      return; // Only save if logged in
    }
    
    try {
      console.log('💾 [saveRecentSearchesToAPI] Saving searches:', searches);
      const token = localStorage.getItem('hum-auth-token');
      // Convert UI format to database format
      const dbFormatSearches = searches.map(search => ({
        query: search.song || '',
        result: {
          title: search.song || '',
          artist: search.artist || '',
          albumArt: search.albumArt || null,
          album: null,
          spotifyUrl: null
        },
        timestamp: search.timestamp ? new Date(search.timestamp) : new Date()
      }));
      
      console.log('💾 [saveRecentSearchesToAPI] Converted to DB format:', dbFormatSearches);
      
      const response = await fetch(`${API_BASE_URL}/api/user/recent-searches`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ recentSearches: dbFormatSearches })
      });
      
      const result = await response.json();
      console.log('💾 [saveRecentSearchesToAPI] API response:', result);
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to save recent searches');
      }
    } catch (error) {
      console.error('❌ [saveRecentSearchesToAPI] Error saving recent searches to API:', error);
      // Fallback to localStorage if API fails
      localStorage.setItem('hum-recent-searches', JSON.stringify(searches));
    }
  };

  const handleSaveNickname = async () => {
    const trimmedNickname = nicknameInput.trim();
    if (!trimmedNickname || !user) return;
    
    try {
      const token = localStorage.getItem('hum-auth-token');
      const response = await fetch(`${API_BASE_URL}/api/user/nickname`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ nickname: trimmedNickname })
      });

      const data = await response.json();
      if (data.success) {
        setNickname(data.nickname);
        setShowNicknameModal(false);
        setNicknameInput('');
        setShowUserDropdown(false);
      } else {
        alert('Failed to save nickname. Please try again.');
      }
    } catch (error) {
      console.error('Error saving nickname:', error);
      alert('Failed to save nickname. Please try again.');
    }
  };

  const handleRemoveNickname = async () => {
    if (!user) return;
    
    try {
      const token = localStorage.getItem('hum-auth-token');
      const response = await fetch(`${API_BASE_URL}/api/user/nickname`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ nickname: null })
      });

      const data = await response.json();
      if (data.success) {
        setNickname('');
        setShowUserDropdown(false);
      } else {
        alert('Failed to remove nickname. Please try again.');
      }
    } catch (error) {
      console.error('Error removing nickname:', error);
      alert('Failed to remove nickname. Please try again.');
    }
  };

  const handleCloseAuth = () => {
    setIsClosingAuth(true);
    setTimeout(() => {
      setShowAuthModal(false);
      setIsClosingAuth(false);
      setAuthError('');
      setAuthEmail('');
      setAuthPassword('');
    }, 300);
  };

  const showWelcomeNotification = (message) => {
    setWelcomeMessage(message);
    setShowWelcome(true);
    // Auto-hide after 5 seconds
    setTimeout(() => {
      setShowWelcome(false);
      setTimeout(() => setWelcomeMessage(null), 300);
    }, 5000);
  };

  // Update relative times every minute
  useEffect(() => {
    const interval = setInterval(() => {
      // Force re-render to update relative times
      setRecentSearches(prev => [...prev]);
    }, 60000); // Every minute
    
    return () => clearInterval(interval);
  }, []);

  // Close user dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (userDropdownRef.current && !userDropdownRef.current.contains(event.target)) {
        setShowUserDropdown(false);
      }
      if (emojiDropdownRef.current && !emojiDropdownRef.current.contains(event.target)) {
        setShowEmojiDropdown(false);
      }
    };

    if (showUserDropdown || showEmojiDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showUserDropdown, showEmojiDropdown]);

  // Prevent body scroll when upgrade modal is open
  useEffect(() => {
    if (showUpgradeModal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    
    return () => {
      document.body.style.overflow = '';
    };
  }, [showUpgradeModal]);

  // Animate background blobs - smooth, slow, fluid movement
  useEffect(() => {
    const animate = () => {
      timeRef.current += 0.005; // Much slower for fluid movement
      
      // Blob 1 - smooth, slow organic movement
      setBlob1Pos({
        x: Math.sin(timeRef.current * 0.15) * 100 + Math.cos(timeRef.current * 0.1) * 60,
        y: Math.cos(timeRef.current * 0.12) * 80 + Math.sin(timeRef.current * 0.18) * 50,
        scale: 1 + Math.sin(timeRef.current * 0.08) * 0.08, // Subtle scale changes
        opacity: 0.25 + Math.sin(timeRef.current * 0.1) * 0.1
      });
      
      // Blob 2 - different phase, slower
      setBlob2Pos({
        x: Math.cos(timeRef.current * 0.13) * 120 + Math.sin(timeRef.current * 0.16) * 70,
        y: Math.sin(timeRef.current * 0.11) * 100 + Math.cos(timeRef.current * 0.14) * 60,
        scale: 1 + Math.cos(timeRef.current * 0.09) * 0.1,
        opacity: 0.2 + Math.cos(timeRef.current * 0.12) * 0.1
      });
      
      // Blob 3 - slowest, most fluid
      setBlob3Pos({
        x: Math.sin(timeRef.current * 0.14) * 110 + Math.cos(timeRef.current * 0.17) * 65,
        y: Math.cos(timeRef.current * 0.1) * 90 + Math.sin(timeRef.current * 0.15) * 55,
        scale: 1 + Math.sin(timeRef.current * 0.07) * 0.09,
        opacity: 0.22 + Math.sin(timeRef.current * 0.11) * 0.1
      });
      
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    
    animationFrameRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (matchData && matchData[0]) {
      const isSongSaved = savedSongs.some(
        song => song.title === matchData[0].title && song.artist === matchData[0].artist
      );
      setIsSaved(isSongSaved);
    }
  }, [matchData, savedSongs]);

  // Auto-select Avid Listener plan when upgrade modal opens
  useEffect(() => {
    if (showUpgradeModal && !selectedPlan) {
      setSelectedPlan('Avid Listener');
    }
  }, [showUpgradeModal, selectedPlan]);

  useEffect(() => {
    if (isListening) {
      let currentLevel = 0;
      const interval = setInterval(() => {
        const change = (Math.random() - 0.5) * 20;
        currentLevel = Math.max(20, Math.min(85, currentLevel + change));
        setAudioLevel(currentLevel);
      }, 100);
      return () => clearInterval(interval);
    } else {
      setAudioLevel(0);
    }
  }, [isListening]);

  const checkSearchLimit = () => {
    if (userTier === 'unlimited') return true; // Unlimited users have no limits
    
    if (userTier === 'avid') {
      // Avid Listener: 100 searches per month
      if (searchCount >= AVID_LISTENER_LIMIT) {
        setShowUpgradeModal(true);
        return false;
      }
      return true;
    }
    
    // Free tier logic
    if (user) {
      // Authenticated free user: 5 total searches
    if (searchCount >= FREE_SEARCH_LIMIT) {
      setShowUpgradeModal(true);
      return false;
    }
    } else {
      // Anonymous user: 1 search only
      if (anonymousSearchCount >= ANONYMOUS_SEARCH_LIMIT) {
        setShowAuthModal(true);
        return false;
      }
    }
    return true;
  };


  const startRecording = async () => {
    // Check if user has reached their limit
    if (!checkSearchLimit()) {
      return;
    }

    // Show error if out of searches
    if (!user && anonymousSearchCount >= ANONYMOUS_SEARCH_LIMIT) {
      setShowAuthModal(true);
      return;
    }
    if (user && userTier === 'free' && searchCount >= FREE_SEARCH_LIMIT) {
      setOutOfSearchesError(true);
      setTimeout(() => setOutOfSearchesError(false), 3000);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        } 
      });
      
      audioChunksRef.current = [];
      
      // Detect supported mimeType (iOS Safari doesn't support webm)
      let mimeType = 'audio/webm';
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      
      if (isIOS) {
        // Try to find a supported mimeType for iOS
        const possibleTypes = [
          'audio/mp4',
          'audio/aac',
          'audio/mpeg',
          'audio/webm'
        ];
        
        for (const type of possibleTypes) {
          if (MediaRecorder.isTypeSupported(type)) {
            mimeType = type;
            console.log('📱 iOS detected, using mimeType:', mimeType);
            break;
          }
        }
      } else {
        // For non-iOS, prefer webm but fallback to others
        if (!MediaRecorder.isTypeSupported('audio/webm')) {
          if (MediaRecorder.isTypeSupported('audio/mp4')) {
            mimeType = 'audio/mp4';
          } else if (MediaRecorder.isTypeSupported('audio/aac')) {
            mimeType = 'audio/aac';
          }
        }
      }
      
      console.log('🎤 Creating MediaRecorder with mimeType:', mimeType);
      console.log('   Stream active:', stream.active);
      console.log('   Audio tracks:', stream.getAudioTracks().length);
      
      // Check if MediaRecorder is supported
      if (!window.MediaRecorder) {
        throw new Error('MediaRecorder is not supported in this browser. Please use a modern browser.');
      }
      
      let mediaRecorder;
      try {
        mediaRecorder = new MediaRecorder(stream, {
          mimeType: mimeType
        });
      } catch (recorderError) {
        console.error('❌ Failed to create MediaRecorder:', recorderError);
        // Try without mimeType specification
        console.log('   Trying without mimeType specification...');
        mediaRecorder = new MediaRecorder(stream);
        console.log('   Using default mimeType:', mediaRecorder.mimeType);
      }
      
      mediaRecorder.onerror = (event) => {
        console.error('❌ MediaRecorder error:', event.error);
        setError(`Recording error: ${event.error?.message || 'Unknown error'}. Please try again.`);
        setIsListening(false);
        setIsProcessing(false);
        stream.getTracks().forEach(track => track.stop());
      };
      
      mediaRecorder.ondataavailable = (event) => {
        console.log('📦 Data available:', event.data.size, 'bytes');
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        // Use the same mimeType that was used for recording
        const blobType = mediaRecorder.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { 
          type: blobType
        });
        
        console.log('🎤 Recording stopped');
        console.log('   Audio chunks:', audioChunksRef.current.length);
        console.log('   Total chunks size:', audioChunksRef.current.reduce((sum, chunk) => sum + chunk.size, 0), 'bytes');
        console.log('   Blob size:', blob.size, 'bytes');
        console.log('   Blob type:', blob.type);
        console.log('   MediaRecorder state:', mediaRecorder.state);
        
        stream.getTracks().forEach(track => {
          track.stop();
          console.log('   Track stopped:', track.kind, track.readyState);
        });
        
        if (blob.size < 100) {
          console.error('❌ Audio blob too small:', blob.size, 'bytes');
          console.error('   Chunks received:', audioChunksRef.current.length);
          console.error('   MediaRecorder mimeType:', mediaRecorder.mimeType);
          setError('Recording failed. The microphone may not be working. Please check permissions and try again.');
          setIsProcessing(false);
          return;
        }
        
        setAudioBlob(blob);
        await identifySong(blob);
      };
      
      mediaRecorderRef.current = mediaRecorder;
      
      // Store interval ID for cleanup
      let dataInterval = null;
      
      // For iOS, try starting without timeslice first, then request data
      if (isIOS) {
        console.log('📱 iOS: Starting MediaRecorder without timeslice');
        mediaRecorder.start();
        // Request data periodically for iOS
        dataInterval = setInterval(() => {
          if (mediaRecorder.state === 'recording') {
            try {
              mediaRecorder.requestData();
            } catch (e) {
              console.warn('Could not request data:', e);
            }
          } else {
            if (dataInterval) clearInterval(dataInterval);
          }
        }, 500);
        // Store interval on recorder for cleanup
        mediaRecorder._dataInterval = dataInterval;
      } else {
        // For other platforms, use timeslice
      mediaRecorder.start(100);
      }
      setIsListening(true);
      setError(null);
      
      const stopTimeout = setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
          setIsListening(false);
        }
        // Clean up interval
        if (dataInterval) {
          clearInterval(dataInterval);
        }
      }, 15000);
      
      // Store timeout for cleanup
      mediaRecorderRef.current._stopTimeout = stopTimeout;
      
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setError('Could not access microphone. Please allow microphone permissions.');
      setIsListening(false);
    }
  };

  const identifySong = async (audioBlob) => {
    setIsProcessing(true);
    setError(null);
    try {
      console.log('🎤 identifySong called');
      console.log('   Blob size:', audioBlob.size, 'bytes');
      console.log('   Blob type:', audioBlob.type);
      
      if (!audioBlob || audioBlob.size < 100) {
        throw new Error('Invalid audio recording. Please try again.');
      }
      
      const formData = new FormData();
      // Use appropriate file extension based on blob type
      const extension = audioBlob.type.includes('mp4') ? 'mp4' : 
                       audioBlob.type.includes('aac') ? 'aac' : 'webm';
      formData.append('audio', audioBlob, `recording.${extension}`);
      
      // Verify FormData
      console.log('   FormData created, checking audio field...');
      const audioField = formData.get('audio');
      console.log('   Audio field in FormData:', audioField ? `${audioField.size} bytes` : 'MISSING');
      
      const token = localStorage.getItem('hum-auth-token');
      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      console.log('🎤 Sending request to:', `${API_BASE_URL}/api/identify`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
      
      const response = await fetch(`${API_BASE_URL}/api/identify`, {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        console.error('❌ Failed to parse JSON response:', jsonError);
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }
      
      console.log('✅ Response received:', data);
      
      if (!response.ok) {
        console.error('❌ Response not OK:', response.status, response.statusText, data);
        // Handle error responses
        if (response.status === 403 && data.requiresLogin) {
          setShowAuthModal(true);
          setError('Please create an account or login to continue searching.');
          setIsProcessing(false);
          setAnonymousSearchCount(ANONYMOUS_SEARCH_LIMIT);
          localStorage.setItem('hum-anonymous-search-count', ANONYMOUS_SEARCH_LIMIT.toString());
          return;
        }
        throw new Error(data.error || data.message || `Server error: ${response.status}`);
      }
      
      if (data.success && data.songs && data.songs.length > 0) {
        setMatchData(data.songs);
        setHasResult(true);
        setIsProcessing(false); // Clear loading state immediately
        setError(null);
        
        // Update search counts
        if (user) {
          setSearchCount(prev => {
            const newCount = prev + 1;
            localStorage.setItem('hum-search-count', newCount.toString());
            return newCount;
          });
        } else {
          // Anonymous search was used - sync with backend
          setAnonymousSearchCount(ANONYMOUS_SEARCH_LIMIT);
          localStorage.setItem('hum-anonymous-search-count', ANONYMOUS_SEARCH_LIMIT.toString());
          // Also check backend status to ensure sync
          checkAnonymousStatus();
        }
        
        // Save to recent searches
        const newSearch = {
          song: data.songs[0].title,
          artist: data.songs[0].artist,
          albumArt: data.songs[0].spotify?.album_art || null,
          timestamp: Date.now()
        };
        
        // Add to beginning of array, keep max 10
        const updatedSearches = [newSearch, ...recentSearches].slice(0, 8);
        setRecentSearches(updatedSearches);
        // Save to API if logged in, otherwise localStorage
        if (user) {
          saveRecentSearchesToAPI(updatedSearches);
        } else {
        localStorage.setItem('hum-recent-searches', JSON.stringify(updatedSearches));
        }
      } else {
        setError(data.message || 'No match found. Try humming more clearly.');
        setHasResult(false);
        setMatchData(null);
      }
    } catch (err) {
      console.error('❌ Error identifying song:', err);
      if (err.name === 'AbortError') {
        setError('Request timed out. The server may be slow to respond. Please try again.');
      } else if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        setError(`Cannot connect to server. Please check your internet connection. API URL: ${API_BASE_URL}`);
      } else {
        setError(`Failed to identify song: ${err.message}. Please try again.`);
      }
      setIsProcessing(false);
    }
  };

  const searchByLyrics = async () => {
    if (!lyricsInput.trim()) return;
    
    // Check if user has reached their limit
    if (!checkSearchLimit()) {
      return;
    }

    setIsSearchingLyrics(true);
    setError(null);
    
    try {
      const token = localStorage.getItem('hum-auth-token');
      const headers = {
          'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      console.log('🔍 Sending lyrics search to:', `${API_BASE_URL}/api/search-lyrics`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
      
      const response = await fetch(`${API_BASE_URL}/api/search-lyrics`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ lyrics: lyricsInput }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        console.error('❌ Failed to parse JSON response:', jsonError);
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }
      
      console.log('✅ Lyrics search response:', data);
      
      if (!response.ok) {
        console.error('❌ Response not OK:', response.status, response.statusText, data);
        if (response.status === 403 && data.requiresLogin) {
          setShowAuthModal(true);
          setError('Please create an account or login to continue searching.');
          setIsSearchingLyrics(false);
          setAnonymousSearchCount(ANONYMOUS_SEARCH_LIMIT);
          localStorage.setItem('hum-anonymous-search-count', ANONYMOUS_SEARCH_LIMIT.toString());
          return;
        }
        throw new Error(data.error || data.message || `Server error: ${response.status}`);
      }
      
      if (data.success && data.songs && data.songs.length > 0) {
        // Check if we have multiple interpretations
        if (data.hasMultipleInterpretations && data.alternativeResults) {
          console.log('Multiple interpretations available:', data);
          
          // Combine both result sets with labels
          const combinedResults = [
            ...data.songs.map(song => ({
              ...song,
              interpretationLabel: data.originalInterpretation 
                ? `Results for "${data.originalInterpretation.query}"` 
                : 'Original interpretation'
            })),
            // Add separator
            { isSeparator: true, label: '─────── or ───────' },
            ...data.alternativeResults.songs.map(song => ({
              ...song,
              interpretationLabel: data.alternativeResults.label || 'Alternative interpretation',
              isAlternative: true
            }))
          ];
          
          setMatchData(combinedResults);
        } else {
          setMatchData(data.songs);
        }
        
        setHasResult(true);
        setIsSearchingLyrics(false); // Clear loading state immediately
        setLyricsInput('');
        
        // Update search counts
        if (user) {
          setSearchCount(prev => {
            const newCount = prev + 1;
            localStorage.setItem('hum-search-count', newCount.toString());
            return newCount;
          });
        } else {
          // Anonymous search was used - sync with backend
          setAnonymousSearchCount(ANONYMOUS_SEARCH_LIMIT);
          localStorage.setItem('hum-anonymous-search-count', ANONYMOUS_SEARCH_LIMIT.toString());
          // Also check backend status to ensure sync
          checkAnonymousStatus();
        }
        
        // Show warning if results may not be accurate
        if (data.note) {
          setError(`⚠️ ${data.note}`);
        } else {
          setError(null);
        }
        
        // Save to recent searches (use top result)
        const topResult = data.songs[0];
        const newSearch = {
          song: topResult.title,
          artist: topResult.artist,
          albumArt: topResult.spotify?.album_art || null,
          timestamp: Date.now()
        };
        
        const updatedSearches = [newSearch, ...recentSearches].slice(0, 8);
        setRecentSearches(updatedSearches);
        // Save to API if logged in, otherwise localStorage
        if (user) {
          saveRecentSearchesToAPI(updatedSearches);
        } else {
        localStorage.setItem('hum-recent-searches', JSON.stringify(updatedSearches));
        }
      } else {
        // Show error with suggestion if available
        const errorMessage = data.message || 'No match found. Try different lyrics.';
        const suggestion = data.suggestion ? `\n\n💡 ${data.suggestion}` : '';
        setError(errorMessage + suggestion);
        setHasResult(false);
        setMatchData(null);
        setIsSearchingLyrics(false); // Clear loading state on error too
      }
    } catch (err) {
      console.error('❌ Error searching lyrics:', err);
      if (err.name === 'AbortError') {
        setError('Request timed out. The server may be slow to respond. Please try again.');
      } else if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        setError(`Cannot connect to server. Please check your internet connection. API URL: ${API_BASE_URL}`);
      } else {
        setError(`Failed to search: ${err.message}. Please try again.`);
      }
    } finally {
      setIsSearchingLyrics(false);
    }
  };

  const handleLyricsKeyPress = (e) => {
    if (e.key === 'Enter') {
      searchByLyrics();
    }
  };

  const insertEmoji = (emoji) => {
    setNicknameInput(prev => prev + emoji);
    setShowEmojiDropdown(false);
  };

  const popularEmojis = ['😎', '🔥', '✨', '💫', '⭐', '🌟', '🎯', '💯', '🚀', '🎨', '🌈', '❤️', '🦋', '🌸', '🌙', '⚡'];

  const sendFeedback = async (correctSong) => {
    try {
      if (!audioBlob) {
        alert('No audio available. Please record again.');
        return;
      }

      setIsSendingFeedback(true);
      setFeedbackSuccess(false);

      const formData = new FormData();
      const extension = audioBlob.type.includes('mp4') ? 'mp4' : 
                       audioBlob.type.includes('aac') ? 'aac' : 'webm';
      formData.append('audio', audioBlob, `recording.${extension}`);
      formData.append('songId', correctSong.id);
      formData.append('title', correctSong.title);
      formData.append('artist', correctSong.artist);
      
      const response = await fetch(`${API_BASE_URL}/api/feedback`, {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      
      if (data.success) {
        setFeedbackSuccess(true);
        setTimeout(() => {
          setShowFeedback(false);
          setFeedbackSuccess(false);
        }, 2000);
      } else {
        alert('❌ Failed to record feedback. Please try again.');
      }
    } catch (err) {
      console.error('Error sending feedback:', err);
      alert('❌ Error sending feedback.');
    } finally {
      setIsSendingFeedback(false);
    }
  };

  const sendGeneralFeedback = async () => {
    if (!feedbackText.trim()) {
      alert('Please enter some feedback');
      return;
    }

    if (feedbackText.length > 500) {
      alert('Feedback must be under 500 characters');
      return;
    }

    try {
      setIsSendingGeneralFeedback(true);

      const response = await fetch(`${API_BASE_URL}/api/general-feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          feedback: feedbackText,
          songTitle: matchData?.[0]?.title || 'N/A',
          songArtist: matchData?.[0]?.artist || 'N/A',
          timestamp: new Date().toISOString()
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        alert('✅ Thank you for your feedback!');
        setShowGeneralFeedback(false);
        setFeedbackText('');
      } else {
        alert('❌ Failed to send feedback. Please try again.');
      }
    } catch (err) {
      console.error('Error sending general feedback:', err);
      alert('❌ Error sending feedback.');
    } finally {
      setIsSendingGeneralFeedback(false);
    }
  };

  const toggleSave = () => {
    if (!matchData?.[0]) return;
    
    const song = matchData[0];
    const songData = {
      title: song.title,
      artist: song.artist,
      album: song.album,
      albumArt: song.spotify?.album_art || null,
      spotifyUrl: song.spotify?.external_url || null,
      timestamp: new Date().toISOString()
    };
    
    let newSavedSongs;
    if (isSaved) {
      // Unbookmarking - no animation
      newSavedSongs = savedSongs.filter(
        s => !(s.title === song.title && s.artist === song.artist)
      );
    } else {
      // Bookmarking - trigger animation
      setBookmarkAnimating(true);
      setTimeout(() => setBookmarkAnimating(false), 400);
      
      newSavedSongs = [songData, ...savedSongs];
    }
    
    setSavedSongs(newSavedSongs);
    // Save to API if logged in, otherwise localStorage
    if (user) {
      saveBookmarksToAPI(newSavedSongs);
    } else {
    localStorage.setItem('hum-saved-songs', JSON.stringify(newSavedSongs));
    }
    setIsSaved(!isSaved);
  };

  const removeBookmark = (song) => {
    const newSavedSongs = savedSongs.filter(
      s => !(s.title === song.title && s.artist === song.artist)
    );
    setSavedSongs(newSavedSongs);
    // Save to API if logged in, otherwise localStorage
    if (user) {
      saveBookmarksToAPI(newSavedSongs);
    } else {
    localStorage.setItem('hum-saved-songs', JSON.stringify(newSavedSongs));
    }
  };

  const resetApp = () => {
    setHasResult(false);
    setMatchData(null);
    setError(null);
    setIsListening(false);
    setIsProcessing(false);
    setShowFeedback(false);
    setAudioBlob(null);
  };

  const handleCloseFeedback = () => {
    setIsClosingFeedback(true);
    setTimeout(() => {
      setShowGeneralFeedback(false);
      setFeedbackText('');
      setIsClosingFeedback(false);
    }, 250);
  };

  const handleCloseBookmarks = () => {
    setIsClosingBookmarks(true);
    setTimeout(() => {
      setShowBookmarks(false);
      setIsClosingBookmarks(false);
    }, 300);
  };

  const handleResetApp = () => {
    setIsClosingResults(true);
    setIsHomepageAnimating(false);
    // Wait for fade-out transition to complete before changing state
    setTimeout(() => {
      // Reset state after fade-out completes
      resetApp();
      setIsClosingResults(false);
      // Force a reflow to ensure DOM is ready
      void document.body.offsetHeight;
      // Start animation on next frame
      requestAnimationFrame(() => {
        setIsHomepageAnimating(true);
        setTimeout(() => setIsHomepageAnimating(false), 450);
      });
    }, 450);
  };

  const handleCloseTips = () => {
    setIsClosingTips(true);
    setTimeout(() => {
      setShowTips(false);
      setIsClosingTips(false);
    }, 200);
  };

  // Calculate days until monthly reset (1st of next month)
  const getDaysUntilReset = () => {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const diffTime = nextMonth - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const handleCloseUpgrade = () => {
    setIsClosingUpgrade(true);
    setTimeout(() => {
      setShowUpgradeModal(false);
      setIsClosingUpgrade(false);
      setSelectedPlan(null);
    }, 300);
  };

  const handleSelectPlan = (plan) => {
    // Just select the plan, don't upgrade yet
    setSelectedPlan(plan);
  };

  const handleContinueUpgrade = async () => {
    // This is where the actual payment happens
    if (selectedPlan) {
      const tier = selectedPlan === 'Avid Listener' ? 'avid' : 'unlimited';
      
      try {
        const token = localStorage.getItem('hum-auth-token');
        if (!token) {
          setShowAuthModal(true);
      handleCloseUpgrade();
          return;
        }

        // Create Stripe checkout session
        const response = await fetch(`${API_BASE_URL}/api/payments/create-checkout-session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ plan: tier })
        });

        const data = await response.json();

        if (data.success && data.url) {
          // Redirect to Stripe Checkout
          window.location.href = data.url;
        } else {
          alert('Failed to start payment. Please try again.');
        }
      } catch (error) {
        console.error('Payment error:', error);
        alert('Failed to process payment. Please try again.');
      }
    }
  };

  return (
    // OLD BACKGROUND (to revert, replace className below with): bg-gradient-to-b from-[#0A0E27] via-[#141937] to-[#1a1d3a]
    <div className="min-h-screen text-white relative overflow-hidden" style={{ 
      background: '#000000',
      backgroundImage: `radial-gradient(circle, rgba(255, 255, 255, 0.08) 1px, transparent 1px)`,
      backgroundSize: '32px 32px',
      backgroundPosition: '0 0'
    }}>
      <style>{`

        /* Animated blob keyframes - organic, large movements with subtle fade */
        @keyframes blobFloat1 {
          0% {
            transform: translate(0%, 0%) scale(1);
            opacity: 0.2;
          }
          20% {
            transform: translate(15%, -10%) scale(1.15);
            opacity: 0.35;
          }
          40% {
            transform: translate(-8%, -18%) scale(0.9);
            opacity: 0.25;
          }
          60% {
            transform: translate(20%, -6%) scale(1.1);
            opacity: 0.3;
          }
          80% {
            transform: translate(6%, -12%) scale(1.05);
            opacity: 0.28;
          }
          100% {
            transform: translate(0%, 0%) scale(1);
            opacity: 0.2;
          }
        }

        @keyframes blobFloat2 {
          0% {
            transform: translate(0%, 0%) scale(1);
            opacity: 0.15;
          }
          25% {
            transform: translate(-18%, 12%) scale(1.2);
            opacity: 0.3;
          }
          50% {
            transform: translate(10%, 20%) scale(0.85);
            opacity: 0.2;
          }
          75% {
            transform: translate(-10%, 8%) scale(1.1);
            opacity: 0.25;
          }
          100% {
            transform: translate(0%, 0%) scale(1);
            opacity: 0.15;
          }
        }

        @keyframes blobFloat3 {
          0% {
            transform: translate(-50%, -50%) translate(0%, 0%) scale(1);
            opacity: 0.18;
          }
          15% {
            transform: translate(-50%, -50%) translate(22%, -14%) scale(1.25);
            opacity: 0.32;
          }
          30% {
            transform: translate(-50%, -50%) translate(-12%, 10%) scale(0.9);
            opacity: 0.22;
          }
          50% {
            transform: translate(-50%, -50%) translate(8%, -22%) scale(1.15);
            opacity: 0.28;
          }
          70% {
            transform: translate(-50%, -50%) translate(-16%, -8%) scale(0.95);
            opacity: 0.2;
          }
          85% {
            transform: translate(-50%, -50%) translate(12%, 14%) scale(1.08);
            opacity: 0.26;
          }
          100% {
            transform: translate(-50%, -50%) translate(0%, 0%) scale(1);
            opacity: 0.18;
          }
        }

        .blob-animate-1 {
          animation: blobFloat1 15s ease-in-out infinite;
          will-change: transform, opacity;
        }

        .blob-animate-2 {
          animation: blobFloat2 18s ease-in-out infinite;
          will-change: transform, opacity;
        }

        .blob-animate-3 {
          animation: blobFloat3 20s ease-in-out infinite;
          will-change: transform, opacity;
        }
        @keyframes float {
          0%, 100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-15px);
          }
        }
        
        .animate-float {
          animation: float 3s ease-in-out infinite;
        }

        @keyframes slideIn {
          from {
            transform: translateX(-100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }

        @keyframes slideOut {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(-100%);
            opacity: 0;
          }
        }
        
        .animate-slide-in {
          animation: slideIn 0.3s ease-out forwards;
        }

        .animate-slide-out {
          animation: slideOut 0.25s ease-in forwards;
        }

        @keyframes wave {
          0%, 40%, 100% {
            transform: translateY(0);
          }
          20% {
            transform: translateY(-20px);
          }
        }
        
        .animate-wave {
          animation: wave 1.2s ease-in-out infinite;
        }

        @keyframes modalFadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes modalFadeOut {
          from {
            opacity: 1;
          }
          to {
            opacity: 0;
          }
        }

        @keyframes modalSlideUp {
          from {
            transform: translateY(20px) scale(0.95);
            opacity: 0;
          }
          to {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
        }

        @keyframes modalSlideDown {
          from {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
          to {
            transform: translateY(20px) scale(0.95);
            opacity: 0;
          }
        }
        
        .animate-modal-backdrop {
          animation: modalFadeIn 0.2s ease-out forwards;
        }

        .animate-modal-backdrop-out {
          animation: modalFadeOut 0.2s ease-out forwards;
        }
        
        .animate-modal-content {
          animation: modalSlideUp 0.3s ease-out forwards;
        }

        .animate-modal-content-out {
          animation: modalSlideDown 0.25s ease-in forwards;
        }

        @keyframes bookmarkPulse {
          0%, 100% {
            transform: scale(1) rotate(0deg);
            opacity: 1;
          }
          25% {
            transform: scale(1.15) rotate(-8deg);
            opacity: 0.9;
          }
          50% {
            transform: scale(1.2) rotate(0deg);
            opacity: 1;
          }
          75% {
            transform: scale(1.15) rotate(8deg);
            opacity: 0.9;
          }
        }

        .animate-bookmark-pulse {
          animation: bookmarkPulse 0.4s ease-out;
          will-change: transform, opacity;
        }

        @keyframes fadeOutDown {
          from {
            opacity: 1;
            transform: translateY(0) translateZ(0);
          }
          to {
            opacity: 0;
            transform: translateY(20px) translateZ(0);
          }
        }

        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(10px) translateZ(0);
          }
          to {
            opacity: 1;
            transform: translateY(0) translateZ(0);
          }
        }

        .animate-fade-out-down {
          opacity: 0;
          transform: translateY(20px) translateZ(0);
          transition: opacity 0.4s ease-out, transform 0.4s ease-out;
          will-change: transform, opacity;
        }

        .animate-fade-in-up {
          animation: fadeInUp 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
          will-change: transform, opacity;
          backface-visibility: hidden;
          will-change: transform, opacity;
          backface-visibility: hidden;
        }

        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes slideUp {
          from {
            opacity: 1;
            transform: translateY(0);
          }
          to {
            opacity: 0;
            transform: translateY(-10px);
          }
        }

        .animate-slide-down {
          animation: slideDown 0.3s ease-out forwards;
        }

        .animate-slide-up {
          animation: slideUp 0.2s ease-in forwards;
        }

        @keyframes blink {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.3;
          }
        }

        .animate-blink {
          animation: blink 1.5s ease-in-out infinite;
        }

        @keyframes dotRotate {
          0% {
            transform: translate(-50%, -50%) rotate(0deg) translateX(8px) rotate(0deg);
          }
          100% {
            transform: translate(-50%, -50%) rotate(360deg) translateX(8px) rotate(-360deg);
          }
        }

        /* Fix autofill styling to keep dark background - match exact input styling */
        input:-webkit-autofill,
        input:-webkit-autofill:hover,
        input:-webkit-autofill:focus,
        input:-webkit-autofill:active {
          -webkit-box-shadow: 0 0 0 1000px rgba(255, 255, 255, 0.05) inset !important;
          box-shadow: 0 0 0 1000px rgba(255, 255, 255, 0.05) inset !important;
          -webkit-text-fill-color: #ffffff !important;
          caret-color: #ffffff !important;
          border: 1px solid rgba(255, 255, 255, 0.1) !important;
          background-color: rgba(255, 255, 255, 0.05) !important;
          transition: background-color 5000s ease-in-out 0s, border-color 200ms ease-in-out !important;
        }
        
        input:-webkit-autofill:focus {
          -webkit-box-shadow: 0 0 0 1000px rgba(255, 255, 255, 0.08) inset !important;
          box-shadow: 0 0 0 1000px rgba(255, 255, 255, 0.08) inset !important;
          border: 1px solid rgba(255, 255, 255, 0.3) !important;
          background-color: rgba(255, 255, 255, 0.08) !important;
        }
        
        /* Prevent stutter when autofill state changes */
        input {
          transition: background-color 200ms ease-in-out, border-color 200ms ease-in-out !important;
        }

        /* Sleek Scrollbar Styles */
        * {
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
        }

        *::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }

        *::-webkit-scrollbar-track {
          background: transparent;
        }

        *::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 10px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }

        *::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
          background-clip: padding-box;
        }

        *::-webkit-scrollbar-thumb:active {
          background: rgba(255, 255, 255, 0.4);
          background-clip: padding-box;
        }
      `}</style>

      <div className="relative z-10">
        {/* Welcome Notification */}
        {showWelcome && welcomeMessage && (
          <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 animate-fade-in-up">
            <div className="relative">
              {/* Glow effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-purple-500/30 to-blue-500/30 rounded-2xl blur-xl"></div>
              {/* Notification card */}
              <div className="relative bg-gradient-to-br from-purple-500/20 via-blue-500/20 to-pink-500/20 backdrop-blur-xl rounded-2xl p-6 border-2 border-white/20 shadow-2xl max-w-md">
                <div className="flex items-start gap-4">
                  <div className="text-4xl animate-bounce">🎵</div>
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-white mb-1">Welcome to hüm!</h3>
                    <p className="text-white/90 text-sm leading-relaxed">{welcomeMessage}</p>
      </div>
                  <button
                    onClick={() => {
                      setShowWelcome(false);
                      setTimeout(() => setWelcomeMessage(null), 300);
                    }}
                    className="p-1 hover:bg-white/10 rounded-full transition-all"
                  >
                    <X className="w-4 h-4 text-white/70" />
                  </button>
                </div>
                {/* Sparkle decorations */}
                <div className="absolute top-2 right-2 text-yellow-300 text-lg animate-pulse">✨</div>
                <div className="absolute bottom-2 left-2 text-yellow-300 text-sm animate-pulse" style={{ animationDelay: '0.5s' }}>⭐</div>
              </div>
            </div>
          </div>
        )}

        {/* Debug Reset Button - Remove this later */}
        <button
          onClick={async () => {
            localStorage.removeItem('hum-pro-status');
            localStorage.removeItem('hum-user-tier');
            localStorage.setItem('hum-search-count', '0');
            localStorage.removeItem('hum-initial-searches-used');
            setIsPro(false);
            setUserTier('free');
            setSearchCount(0);
            setHasUsedInitialSearches(false);
            
            // Also reset backend search count if logged in
            if (user) {
              try {
                const token = localStorage.getItem('hum-auth-token');
                // Update user's searchCount to 0 on backend
                const response = await fetch(`${API_BASE_URL}/api/user/reset-search-count`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                  }
                });
                
                if (response.ok) {
                  // Reload user data to get updated searchCount
                  await checkAuthStatus(token);
                  alert('Reset complete! Search count has been reset.');
                } else {
                  alert('Error resetting search count. Please refresh the page.');
                }
              } catch (error) {
                console.error('Error resetting backend search count:', error);
                alert('Error resetting search count. Please refresh the page.');
              }
            } else {
            alert('Reset! Refresh the page.');
            }
          }}
          className="fixed bottom-6 left-6 z-50 px-3 py-2 bg-red-500/20 hover:bg-red-500/30 backdrop-blur-sm border border-red-500/30 rounded-full text-xs transition-all"
        >
          🔄 Reset Pro Status
        </button>

        {/* Test Button - Exhaust Searches */}
        <button
          onClick={() => {
            setSearchCount(5);
            localStorage.setItem('hum-search-count', '5');
            localStorage.setItem('hum-initial-searches-used', 'true');
            setHasUsedInitialSearches(true);
          }}
          className="fixed bottom-20 left-6 z-50 px-3 py-2 bg-orange-500/20 hover:bg-orange-500/30 backdrop-blur-sm border border-orange-500/30 rounded-full text-xs transition-all"
        >
          ⚡ Exhaust Searches
        </button>

        {/* Bookmarks Button - Top Left */}
        <button
          onClick={() => setShowBookmarks(!showBookmarks)}
          className="fixed top-6 left-6 z-40 flex items-center gap-2 px-4 py-3 bg-white/5 backdrop-blur-sm border border-white/10 rounded-full hover:bg-white/10 transition-all group"
        >
          <Bookmark 
            className={`w-5 h-5 transition-all duration-200 ease-out ${bookmarkAnimating ? 'animate-bookmark-pulse fill-purple-400/90 text-purple-400' : ''}`} 
            strokeWidth={1.5}
          />
        </button>

        {/* Top Right - User Account & Help Button */}
        <div className="fixed top-6 right-6 z-40 flex items-center gap-2">
          {/* User Account Dropdown (if logged in) */}
          {user && (
            <div className="relative" ref={userDropdownRef}>
              <button
                onClick={() => setShowUserDropdown(!showUserDropdown)}
                className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 backdrop-blur-sm border border-white/10 rounded-full text-sm text-white/70 transition-all"
              >
                <span className="truncate max-w-[150px]">{nickname || user.email}</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${showUserDropdown ? 'rotate-180' : ''}`} />
              </button>

              {/* Dropdown Menu */}
              {showUserDropdown && (
                <div className="absolute top-full right-0 mt-2 w-56 bg-white/[0.03] backdrop-blur-2xl rounded-xl border border-white/20 shadow-2xl z-50 overflow-hidden animate-slide-down">
                  <button
                    onClick={() => {
                      setNicknameInput(nickname);
                      setShowNicknameModal(true);
                      setShowUserDropdown(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-white/80 hover:bg-white/10 transition-colors border-b border-white/10"
                  >
                    <User className="w-4 h-4" />
                    <span>{nickname ? 'change nickname' : 'set nickname'}</span>
                  </button>
                  {nickname && (
                    <button
                      onClick={handleRemoveNickname}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-white/60 hover:bg-white/10 transition-colors border-b border-white/10"
                    >
                      <X className="w-4 h-4" />
                      <span>remove nickname</span>
                    </button>
                  )}
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-white/80 hover:bg-white/10 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>logout</span>
        </button>
                </div>
              )}
            </div>
          )}

          {/* Help Button */}
        <div 
            className="relative"
          onMouseEnter={() => setShowTips(true)}
          onMouseLeave={handleCloseTips}
        >
          <button
            className="flex items-center gap-2 px-4 py-2 bg-white/5 backdrop-blur-sm border border-white/10 rounded-full hover:bg-white/10 transition-all"
          >
              <span className="text-sm font-bold">help!</span>
            <span className="text-base">💡</span>
          </button>

          {/* Help Dropdown */}
          {showTips && (
              <div className={`absolute top-full right-0 mt-2 w-80 bg-white/[0.03] backdrop-blur-2xl rounded-2xl p-6 border border-white/20 shadow-2xl z-50 ${isClosingTips ? 'animate-slide-up' : 'animate-slide-down'}`}>
                <h3 className="font-bold text-lg mb-2.5">welcome to hüm! 🎶</h3>
              <p className="text-sm text-white/70 mb-3.5 leading-relaxed">
                  you can hum, sing, or play a melody to search for the song name.
              </p>
                <p className="text-sm font-bold text-white/80 mb-2">for best results:</p>
              <ul className="space-y-2 text-sm text-white/70">
                <li className="flex items-start gap-2">
                  <span className="text-white/50">•</span>
                    <span>get closer to the mic</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-white/50">•</span>
                    <span>really commit to hitting the right notes</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-white/50">•</span>
                    <span>if you know any lyrics, sing those too</span>
                </li>
              </ul>
            </div>
          )}
          </div>
        </div>

        {/* Search Counter - Top Center */}
        {!user ? (
          anonymousSearchCount >= ANONYMOUS_SEARCH_LIMIT ? (
            // Show login prompt when no searches left
            <button
              key="search-counter-anonymous-login"
              onClick={(e) => {
                e.stopPropagation();
                setShowAuthModal(true);
              }}
              className="fixed top-6 left-1/2 -translate-x-1/2 z-40 px-4 py-2 bg-white/5 hover:bg-gradient-to-r hover:from-purple-500/20 hover:to-blue-500/20 backdrop-blur-sm border border-white/10 hover:border-purple-500/40 rounded-full transition-all duration-300 hover:scale-105 group cursor-pointer"
            >
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-sm text-white/70 group-hover:hidden transition-opacity">
                  Login for more searches
                </span>
                <span className="text-sm text-purple-300 font-semibold hidden group-hover:inline-flex items-center gap-1 transition-opacity">
                  <Star className="w-3.5 h-3.5 fill-purple-300" />
                  Create account or login
                  <Star className="w-3.5 h-3.5 fill-purple-300" />
                </span>
              </div>
            </button>
          ) : (
            // Only show counter when they actually have a search available
            <div
              key="search-counter-anonymous"
              className="fixed top-6 left-1/2 -translate-x-1/2 z-40 px-4 py-2 bg-white/5 backdrop-blur-sm border border-white/10 rounded-full"
            >
              <span className="text-sm text-white/70">
                {ANONYMOUS_SEARCH_LIMIT - anonymousSearchCount}/1 free search left
              </span>
            </div>
          )
        ) : userTier === 'free' ? (
          <button
            key="search-counter"
            onClick={(e) => {
              e.stopPropagation();
              setShowUpgradeModal(true);
            }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-40 px-4 py-2 bg-white/5 hover:bg-gradient-to-r hover:from-purple-500/20 hover:to-blue-500/20 backdrop-blur-sm border border-white/10 hover:border-purple-500/40 rounded-full transition-all duration-300 hover:scale-105 group cursor-pointer"
          >
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-sm text-white/70 group-hover:hidden transition-opacity">
                {searchCount >= FREE_SEARCH_LIMIT
                  ? "no more searches :("
                  : `${FREE_SEARCH_LIMIT - searchCount}/${FREE_SEARCH_LIMIT} free searches left`
                }
              </span>
              <span className="text-sm text-purple-300 font-semibold hidden group-hover:inline-flex items-center gap-1 transition-opacity">
                <Star className="w-3.5 h-3.5 fill-purple-300" />
                Upgrade to Hüm Pro
                <Star className="w-3.5 h-3.5 fill-purple-300" />
              </span>
            </div>
          </button>
        ) : userTier === 'avid' ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowUpgradeModal(true);
            }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-40 px-4 py-2 bg-teal-500/20 hover:bg-teal-500/30 backdrop-blur-sm border border-teal-500/30 hover:border-teal-500/50 rounded-full transition-all duration-300 hover:scale-105 group cursor-pointer"
          >
            <span className="text-sm text-teal-300 font-semibold group-hover:hidden">
              🎧 Avid Listener - {searchCount}/{AVID_LISTENER_LIMIT} this month
            </span>
            <span className="text-sm text-purple-300 font-semibold hidden group-hover:inline-flex items-center gap-1">
              <Star className="w-3.5 h-3.5 fill-purple-300" />
              Upgrade to Unlimited
              <Star className="w-3.5 h-3.5 fill-purple-300" />
            </span>
          </button>
        ) : (
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-40 px-4 py-2 bg-purple-500/20 backdrop-blur-sm border border-purple-500/30 rounded-full">
            <span className="text-sm text-purple-300 font-semibold">
              🧙‍♂️ Unlimited - No Limits!
            </span>
          </div>
        )}

        {/* Authentication Modal */}
        {showAuthModal && (
          <div 
            className={`fixed inset-0 bg-black/70 backdrop-blur-lg flex items-center justify-center z-50 p-4 ${isClosingAuth ? 'animate-modal-backdrop-out' : 'animate-modal-backdrop'}`}
            onClick={handleCloseAuth}
          >
            <div 
              className={`relative ${isClosingAuth ? 'animate-modal-content-out' : 'animate-modal-content'}`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <button 
                onClick={handleCloseAuth}
                className="absolute -top-4 -right-4 z-10 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-all backdrop-blur-sm border border-white/20"
              >
                <X className="w-5 h-5" />
              </button>

              {/* Modal */}
              <div className="relative bg-white/[0.03] backdrop-blur-2xl rounded-3xl p-8 max-w-md w-full border border-white/20 shadow-2xl">
                <h2 className="text-3xl font-bold text-center mb-2">
                  {isLoginMode ? 'welcome back!' : 'create an account'}
                </h2>
                <p className="text-lg text-white/60 text-center mb-6">
                  {isLoginMode 
                    ? 'login to continue searching' 
                    : 'get 4 more free searches (5 total)'}
                </p>

                {authError && (
                  <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-sm">
                    {authError}
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-white/70 mb-2">email</label>
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      placeholder="your@email.com"
                      className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-white/30 focus:bg-white/[0.08] transition-colors duration-200"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          isLoginMode ? handleLogin() : handleSignup();
                        }
                      }}
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-white/70 mb-2">password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={authPassword}
                        onChange={(e) => setAuthPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-3 pr-12 text-white placeholder-white/30 focus:outline-none focus:border-white/30 focus:bg-white/[0.08] transition-all"
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') {
                            isLoginMode ? handleLogin() : handleSignup();
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white/80 transition-colors"
                      >
                        {!showPassword ? (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 30" className="w-6 h-6" fill="currentColor">
                            <g stroke="none" strokeWidth="1" fill="none" fillRule="evenodd">
                              <path d="M12.7296635,21.1661847 C12.7296635,21.6239997 12.3585312,21.995132 11.9007162,21.995132 C11.4429012,21.995132 11.0717688,21.6239997 11.0717688,21.1661847 L11.0717688,20.0609215 C11.0717688,19.6031065 11.4429012,19.2319741 11.9007162,19.2319741 C12.3585312,19.2319741 12.7296635,19.6031065 12.7296635,20.0609215 L12.7296635,21.1661847 Z" fill="currentColor" fillRule="nonzero"/>
                              <path d="M8.30861091,20.5510749 C8.30861091,21.0088899 7.93747853,21.3800223 7.47966354,21.3800223 C7.02184855,21.3800223 6.65071617,21.0088899 6.65071617,20.5510749 L6.65071617,19.4458117 C6.65071617,18.9879968 7.02184855,18.6168644 7.47966354,18.6168644 C7.93747853,18.6168644 8.30861091,18.9879968 8.30861091,19.4458117 L8.30861091,20.5510749 Z" fill="currentColor" fillRule="nonzero" transform="translate(7.479664, 19.998443) rotate(20.000000) translate(-7.479664, -19.998443) "/>
                              <path d="M17.1507162,20.5510749 C17.1507162,21.0088899 16.7795838,21.3800223 16.3217688,21.3800223 C15.8639538,21.3800223 15.4928214,21.0088899 15.4928214,20.5510749 L15.4928214,19.4458117 C15.4928214,18.9879968 15.8639538,18.6168644 16.3217688,18.6168644 C16.7795838,18.6168644 17.1507162,18.9879968 17.1507162,19.4458117 L17.1507162,20.5510749 Z" fill="currentColor" fillRule="nonzero" transform="translate(16.321769, 19.998443) scale(-1, 1) rotate(20.000000) translate(-16.321769, -19.998443) "/>
                              <path d="M21.0631579,18.5616012 C21.0631579,19.0194162 20.6920255,19.3905486 20.2342105,19.3905486 C19.7763955,19.3905486 19.4052632,19.0194162 19.4052632,18.5616012 L19.4052632,17.4563381 C19.4052632,16.9985231 19.7763955,16.6273907 20.2342105,16.6273907 C20.6920255,16.6273907 21.0631579,16.9985231 21.0631579,17.4563381 L21.0631579,18.5616012 Z" fill="currentColor" fillRule="nonzero" transform="translate(20.234211, 18.008970) scale(-1, 1) rotate(35.000000) translate(-20.234211, -18.008970) "/>
                              <path d="M4.26315789,18.5616012 C4.26315789,19.0194162 3.89202552,19.3905486 3.43421053,19.3905486 C2.97639554,19.3905486 2.60526316,19.0194162 2.60526316,18.5616012 L2.60526316,17.4563381 C2.60526316,16.9985231 2.97639554,16.6273907 3.43421053,16.6273907 C3.89202552,16.6273907 4.26315789,16.9985231 4.26315789,17.4563381 L4.26315789,18.5616012 Z" fill="currentColor" fillRule="nonzero" transform="translate(3.434211, 18.008970) rotate(35.000000) translate(-3.434211, -18.008970) "/>
                              <path d="M2.18356954,13.4118965 C3.65553254,16.0777919 8.10236709,18.625 12,18.625 C15.8799564,18.625 20.3024429,16.1029471 21.7976771,13.4455402 C22.0007957,13.0845475 21.8728134,12.6272449 21.5118207,12.4241264 C21.150828,12.2210078 20.6935255,12.3489901 20.4904069,12.7099828 C19.2639874,14.8896385 15.3442219,17.125 12,17.125 C8.64124122,17.125 4.70099679,14.8679737 3.49670178,12.686856 C3.29648738,12.3242446 2.84022687,12.1925958 2.47761541,12.3928102 C2.11500396,12.5930246 1.98335513,13.0492851 2.18356954,13.4118965 Z" fill="currentColor" fillRule="nonzero"/>
                            </g>
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 120" className="w-6 h-6" fill="currentColor">
                            <g data-name="21">
                              <path d="M89.06,53.77a47.11,47.11,0,0,0-82.13,0,8.68,8.68,0,0,0,0,8.44,47.11,47.11,0,0,0,82.13,0A8.67,8.67,0,0,0,89.06,53.77ZM48,72A14,14,0,1,1,62,58,14,14,0,0,1,48,72Z" fill="currentColor"/>
                              <circle cx="48" cy="58" r="9" fill="currentColor"/>
                              <path d="M48,22.5A2.5,2.5,0,0,1,45.5,20V11a2.5,2.5,0,0,1,5,0v9A2.5,2.5,0,0,1,48,22.5Z" fill="currentColor"/>
                              <path d="M69.66,27.34a2.43,2.43,0,0,1-1.3-.36,2.5,2.5,0,0,1-.84-3.44l4.69-7.68a2.5,2.5,0,1,1,4.27,2.6l-4.69,7.68A2.47,2.47,0,0,1,69.66,27.34Z" fill="currentColor"/>
                              <path d="M26.34,27.34a2.47,2.47,0,0,1-2.13-1.2l-4.69-7.68a2.5,2.5,0,1,1,4.27-2.6l4.69,7.68A2.51,2.51,0,0,1,27.64,27,2.43,2.43,0,0,1,26.34,27.34Z" fill="currentColor"/>
                            </g>
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={isLoginMode ? handleLogin : handleSignup}
                    disabled={isAuthenticating}
                    className="w-full bg-gradient-to-b from-indigo-900/40 to-indigo-800/30 hover:from-indigo-900/60 hover:to-indigo-800/50 border border-purple-400/30 hover:border-purple-400/70 rounded-full py-3 font-medium text-base transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ color: '#D8B5FE' }}
                  >
                    {isAuthenticating ? 'please wait...' : (isLoginMode ? 'login' : 'sign up')}
                  </button>

                  <div className="text-center">
                    <button
                      onClick={() => {
                        setIsLoginMode(!isLoginMode);
                        setAuthError('');
                      }}
                      className="text-sm text-white/60 hover:text-white/80 transition-colors"
                    >
                      {isLoginMode 
                        ? "don't have an account? sign up" 
                        : 'already have an account? login'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Upgrade Modal */}
        {showUpgradeModal && (
          <div 
            className={`fixed inset-0 bg-black/70 backdrop-blur-lg flex items-center justify-center z-50 p-4 ${isClosingUpgrade ? 'animate-modal-backdrop-out' : 'animate-modal-backdrop'}`}
            onClick={handleCloseUpgrade}
          >
            <div 
              className={`relative ${isClosingUpgrade ? 'animate-modal-content-out' : 'animate-modal-content'}`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <button 
                onClick={handleCloseUpgrade}
                className="absolute -top-4 -right-4 z-10 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-all backdrop-blur-sm border border-white/20"
              >
                <X className="w-5 h-5" />
              </button>
              
              {/* Modal */}
              <div className="relative bg-white/[0.03] backdrop-blur-2xl rounded-3xl p-6 max-w-xl w-full max-h-[90vh] border border-white/20 shadow-2xl overflow-y-auto">
                <h2 className="text-3xl font-bold text-center mb-6">wanna keep humming?</h2>

                <div className={`grid gap-4 ${userTier === 'avid' && searchCount >= AVID_LISTENER_LIMIT ? 'md:grid-cols-2' : 'md:grid-cols-1 max-w-sm mx-auto'}`}>
                  {/* Avid Listener Plan */}
                  <button
                    onClick={() => handleSelectPlan('Avid Listener')}
                    className={`relative group rounded-2xl overflow-hidden transition-all duration-300 ${
                      selectedPlan === 'Avid Listener' 
                        ? 'scale-[1.025]' 
                        : 'hover:scale-[1.025]'
                    }`}
                  >
                    {/* Card background */}
                    <div className="absolute inset-0 bg-gradient-to-br from-teal-500/10 to-cyan-500/10 backdrop-blur-sm rounded-2xl"></div>
                    <div className={`relative rounded-2xl p-4 border-2 transition-all ${
                      selectedPlan === 'Avid Listener' 
                        ? 'border-teal-500 shadow-[0_0_0_2px_rgba(20,184,166,0.5)]' 
                        : 'border-teal-500/30 hover:border-teal-500/50'
                    }`}>
                      {/* Star badge */}
                      <div className="absolute top-4 left-4">
                        <Star className="w-5 h-5 text-teal-400 fill-teal-400" />
                      </div>

                      {/* Info icon */}
                      <div 
                        className="absolute top-4 right-4 group/info"
                        onMouseEnter={() => setShowAvidInfo(true)}
                        onMouseLeave={() => setShowAvidInfo(false)}
                      >
                        <div className="w-5 h-5 rounded-full border border-white/30 flex items-center justify-center cursor-help hover:border-white/50 transition-colors">
                          <Info className="w-3.5 h-3.5 text-white/60" />
                        </div>
                        
                        {/* Tooltip */}
                        {showAvidInfo && (
                          <div className="absolute top-6 right-0 w-48 bg-black/90 backdrop-blur-xl rounded-xl p-3 border border-teal-500/30 shadow-2xl z-10 animate-slide-down">
                            <p className="text-sm text-white/70 leading-relaxed">
                              get <span className="text-teal-300 font-semibold">100 searches each month.</span> great for casual listening!
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Price */}
                      <div className="text-center mt-2 mb-4">
                        <div className="text-4xl font-bold mb-1">$1<span className="text-xl text-white/60">/month</span></div>
                      </div>

                      {/* Character illustration */}
                      <div className="relative h-52 flex items-center justify-center mb-4">
                        <img 
                          src={avidListenerIcon} 
                          alt="avid listener" 
                          className="w-full h-full object-contain drop-shadow-2xl"
                        />
                        {/* Stars decoration */}
                        <div className="absolute inset-0 pointer-events-none">
                          <Star className="absolute top-4 left-8 w-6 h-6 text-yellow-400 fill-yellow-400 opacity-80" />
                          <Star className="absolute top-8 right-12 w-5 h-5 text-yellow-400 fill-yellow-400 opacity-60" />
                          <Star className="absolute bottom-12 left-6 w-4 h-4 text-yellow-400 fill-yellow-400 opacity-70" />
                          <Star className="absolute top-16 right-6 w-3 h-3 text-yellow-400 fill-yellow-400 opacity-50" />
                        </div>
                      </div>

                      {/* Plan name */}
                      <div className="text-center">
                        <h3 className="text-lg font-bold">avid listener</h3>
                        <p className="text-xs text-teal-300/80 mt-1">100 searches per month</p>
                        {userTier === 'avid' && (
                          <p className="text-xs text-white/50 mt-2">
                            resets in {getDaysUntilReset()} {getDaysUntilReset() === 1 ? 'day' : 'days'}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Eat, Breath, Music Plan - Only show when avid tier has used 100 searches */}
                  {userTier === 'avid' && searchCount >= AVID_LISTENER_LIMIT && (
                  <button
                    onClick={() => handleSelectPlan('Eat, Breath, Music')}
                    className={`relative group rounded-3xl overflow-hidden transition-all duration-300 ${
                      selectedPlan === 'Eat, Breath, Music' 
                          ? 'scale-[1.025]' 
                          : 'hover:scale-[1.025]'
                    }`}
                  >
                    {/* Card background */}
                    <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-blue-500/10 backdrop-blur-sm"></div>
                      <div className={`relative rounded-3xl p-6 border-2 transition-all ${
                        selectedPlan === 'Eat, Breath, Music' 
                          ? 'border-purple-500 shadow-[0_0_0_2px_rgba(168,85,247,0.5)]' 
                          : 'border-purple-500/30 hover:border-purple-500/50'
                      }`}>
                      {/* Info icon */}
                      <div 
                        className="absolute top-6 right-6 group/info"
                        onMouseEnter={() => setShowUnlimitedInfo(true)}
                        onMouseLeave={() => setShowUnlimitedInfo(false)}
                      >
                        <div className="w-6 h-6 rounded-full border border-white/30 flex items-center justify-center cursor-help hover:border-white/50 transition-colors">
                          <Info className="w-4 h-4 text-white/60" />
                        </div>
                        
                        {/* Tooltip */}
                        {showUnlimitedInfo && (
                          <div className="absolute top-8 right-0 w-48 bg-black/90 backdrop-blur-xl rounded-xl p-3 border border-purple-500/30 shadow-2xl z-10 animate-slide-down">
                            <p className="text-sm text-white/70 leading-relaxed">
                                enjoy <span className="text-purple-300 font-semibold">unlimited searches</span> with no limits!
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Price */}
                      <div className="text-center mt-4 mb-6">
                        <div className="text-5xl font-bold mb-1">$4<span className="text-2xl text-white/60">/month</span></div>
                      </div>

                      {/* Character illustration */}
                      <div className="relative h-64 flex items-center justify-center mb-6">
                        <img 
                          src={wizardGuyIcon} 
                            alt="music wizard" 
                          className="w-full h-full object-contain drop-shadow-2xl"
                        />
                        {/* Stars decoration */}
                        <div className="absolute inset-0 pointer-events-none">
                          <Star className="absolute top-6 left-10 w-7 h-7 text-yellow-400 fill-yellow-400 opacity-90" />
                          <Star className="absolute top-4 right-8 w-6 h-6 text-yellow-400 fill-yellow-400 opacity-80" />
                          <Star className="absolute bottom-16 left-8 w-5 h-5 text-yellow-400 fill-yellow-400 opacity-70" />
                          <Star className="absolute top-20 right-12 w-4 h-4 text-yellow-400 fill-yellow-400 opacity-60" />
                          <Star className="absolute bottom-8 right-6 w-6 h-6 text-yellow-400 fill-yellow-400 opacity-85" />
                        </div>
                      </div>

                      {/* Plan name */}
                      <div className="text-center">
                          <h3 className="text-2xl font-bold">eat, breath, music</h3>
                          <p className="text-sm text-purple-300/80 mt-1">unlimited searches</p>
                      </div>
                    </div>
                  </button>
                  )}
                </div>

                {/* Payment options (shows when plan selected) */}
                <div 
                  className={`mt-6 transition-all duration-300 ease-in-out ${
                    selectedPlan 
                      ? 'max-h-80 opacity-100 pb-2' 
                      : 'max-h-0 opacity-0 pb-0 overflow-hidden'
                  }`}
                >
                  <div className={selectedPlan ? 'overflow-visible' : 'overflow-hidden'}>
                    {/* Header with decorative lines */}
                    <div className="flex items-center justify-center gap-3 mb-3">
                      <div className="flex-1 h-px bg-white/20"></div>
                      <h3 className="text-lg font-semibold text-white/90 whitespace-nowrap">ready to upgrade?</h3>
                      <div className="flex-1 h-px bg-white/20"></div>
                    </div>
                    <p className="text-center text-white/60 mb-4 text-xs">choose your preferred payment method</p>
                    
                    {/* Payment buttons */}
                    <div className="flex flex-col gap-3 px-1 py-1">
                      {/* Primary: Card payment */}
                    <button
                      onClick={handleContinueUpgrade}
                        className="group relative w-full px-6 py-4 bg-gradient-to-r from-purple-500/20 to-blue-500/20 hover:from-purple-500/30 hover:to-blue-500/30 border-2 border-purple-500/40 hover:border-purple-500/60 rounded-xl font-semibold text-base transition-all duration-200 flex items-center justify-center gap-3 text-white shadow-lg hover:shadow-xl hover:scale-[1.02] backdrop-blur-sm"
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <CreditCard className="w-5 h-5 relative z-10" />
                        <span className="relative z-10">card, apple pay, or google pay</span>
                      </button>
                      
                      {/* Secondary: PayPal */}
                      <button
                        onClick={() => handlePayPalPayment(selectedPlan)}
                        className="group relative w-full px-6 py-4 bg-white/5 hover:bg-white/10 border border-white/20 hover:border-white/40 rounded-xl font-medium text-base transition-all duration-200 flex items-center justify-center gap-3 text-white/90 hover:text-white hover:scale-[1.01] backdrop-blur-sm"
                      >
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.288-.077.437-.983 5.05-4.349 6.797-8.647 6.797h-2.19c-.524 0-.968.382-1.05.9l-1.12 7.2zm14.146-14.42a3.35 3.35 0 0 0-.607-.541c-.013.076-.032.154-.054.237-.983 5.05-4.349 6.797-8.647 6.797h-2.19c-.524 0-.968.382-1.05.9l-1.12 7.2H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.288-.077.437z"/>
                        </svg>
                        <span>PayPal</span>
                    </button>
                  </div>
                    
                    {/* Trust indicator */}
                    <div className="mt-4 flex items-center justify-center gap-2 text-xs text-white/40">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      <span>Secure payment processing</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bookmarks Panel */}
        {showBookmarks && (
          <>
            {/* Backdrop */}
            <div 
              className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-40 ${isClosingBookmarks ? 'animate-modal-backdrop-out' : 'animate-modal-backdrop'}`}
              onClick={handleCloseBookmarks}
            ></div>
            
            {/* Panel */}
            <div className={`fixed top-0 left-0 h-full w-96 bg-gradient-to-br from-[#0a0a0f] via-[#0f0f15] to-[#0a0a0f] backdrop-blur-2xl border-r border-white/[0.08] z-50 overflow-hidden flex flex-col rounded-tr-2xl rounded-br-2xl ${isClosingBookmarks ? 'animate-slide-out' : 'animate-slide-in'}`} style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.03'/%3E%3C/svg%3E")`,
              backgroundSize: '200px 200px'
            }}>
              {/* Header */}
              <div className="p-6 border-b border-white/[0.06]">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center border border-white/10">
                      <Bookmark className="w-5 h-5 text-purple-300" strokeWidth={1.5} fill="currentColor" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-semibold tracking-tight">bookmarks</h2>
                      <p className="text-sm text-white/40 font-light mt-0.5">
                        {savedSongs.length} {savedSongs.length === 1 ? 'song' : 'songs'}
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={handleCloseBookmarks}
                    className="p-2 hover:bg-white/5 rounded-lg transition-all hover:scale-105"
                  >
                    <X className="w-5 h-5 text-white/40" />
                  </button>
                </div>
              </div>

              {/* Bookmarks List */}
              <div className="flex-1 overflow-y-auto p-5">
                {savedSongs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center px-8">
                    <div className="w-24 h-24 rounded-full bg-white/5 backdrop-blur-sm flex items-center justify-center mb-5">
                      <Bookmark className="w-12 h-12 text-white/30" strokeWidth={1.5} fill="none" />
                    </div>
                    <p className="text-xl font-medium mb-2 text-white/70">no bookmarks yet...</p>
                    <p className="text-base text-white/40 font-light leading-relaxed">
                      songs you save will appear here
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {savedSongs.map((song, idx) => (
                      <div 
                        key={idx}
                        className="group relative bg-white/[0.03] backdrop-blur-sm rounded-xl p-3 border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.12] transition-all duration-200 hover:scale-[1.01] cursor-pointer"
                      >
                        <div className="flex items-center gap-3">
                          {/* Album Art */}
                          <div className="w-16 h-16 bg-white/[0.05] rounded-lg overflow-hidden flex-shrink-0 border border-white/[0.08] group-hover:border-white/[0.15] transition-all">
                            {song.albumArt ? (
                              <img 
                                src={song.albumArt} 
                                alt={song.title}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-500/10 to-blue-500/10">
                                <Music className="w-7 h-7 opacity-30" strokeWidth={1} />
                              </div>
                            )}
                          </div>

                          {/* Song Info */}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-base truncate mb-0.5 text-white/90 group-hover:text-white transition-colors">{song.title}</p>
                            <p className="text-sm text-white/50 truncate font-light">{song.artist}</p>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {song.spotifyUrl && (
                              <a
                                href={song.spotifyUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="p-1.5 hover:bg-white/10 rounded-lg transition-all hover:scale-110"
                                title="Open in Spotify"
                              >
                                <Music className="w-4 h-4 text-white/60" strokeWidth={1.5} />
                              </a>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                removeBookmark(song);
                              }}
                              className="p-1.5 hover:bg-red-500/20 rounded-lg transition-all hover:scale-110"
                              title="Remove bookmark"
                            >
                              <X className="w-4 h-4 text-red-400/70" strokeWidth={1.5} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Feedback Modal */}
        {showFeedback && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-modal-backdrop">
            <div className="bg-gradient-to-br from-[#1a1d3a] to-[#0A0E27] rounded-3xl p-8 max-w-md w-full border border-white/10 relative animate-modal-content">
              <button 
                onClick={() => setShowFeedback(false)}
                className="absolute top-4 right-4 p-2 hover:bg-white/5 rounded-full transition-all"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-2xl font-bold mb-4">Help us learn</h3>
              <p className="text-white/60 mb-6">Which song were you humming?</p>

              {feedbackSuccess ? (
                <div className="text-center py-8">
                  <div className="text-6xl mb-4">✅</div>
                  <p className="text-xl">Thanks for the feedback!</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {availableSongs.map(song => (
                    <button
                      key={song.id}
                      onClick={() => sendFeedback(song)}
                      disabled={isSendingFeedback}
                      className="w-full text-left p-4 bg-white/5 hover:bg-white/10 rounded-2xl transition-all border border-white/10 disabled:opacity-50"
                    >
                      <p className="font-bold">{song.title}</p>
                      <p className="text-sm text-white/60">{song.artist}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* General Feedback Modal */}
        {showGeneralFeedback && (
          <div 
            className={`fixed inset-0 bg-black/60 backdrop-blur-lg flex items-center justify-center z-50 p-4 ${isClosingFeedback ? 'animate-modal-backdrop-out' : 'animate-modal-backdrop'}`}
            onClick={handleCloseFeedback}
          >
            <div 
              className={`relative ${isClosingFeedback ? 'animate-modal-content-out' : 'animate-modal-content'}`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Glow effect */}
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-blue-500/10 rounded-3xl blur-3xl"></div>
              
              {/* Modal - Super Glassmorphic */}
              <div className="relative bg-white/[0.03] backdrop-blur-2xl rounded-3xl p-8 max-w-md w-full border border-white/20 shadow-2xl">
                <button 
                  onClick={handleCloseFeedback}
                  className="absolute top-4 right-4 p-2 bg-white/5 hover:bg-white/10 rounded-full transition-all backdrop-blur-sm"
                >
                  <X className="w-5 h-5" />
                </button>

                <h3 className="text-2xl font-bold mb-4">Send us feedback</h3>
                <p className="text-white/70 mb-6">Tell us what happened or how we can improve</p>

                <textarea
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  placeholder="Type your feedback here..."
                  maxLength={500}
                  className="w-full h-32 bg-white/[0.08] backdrop-blur-xl border border-white/20 rounded-2xl p-4 text-white placeholder-white/50 focus:outline-none focus:border-white/40 focus:bg-white/[0.12] transition-all resize-none mb-3 shadow-inner"
                />
                
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/50">
                    {feedbackText.length}/500 characters
                  </span>
                  
                  <button
                    onClick={sendGeneralFeedback}
                    disabled={isSendingGeneralFeedback || !feedbackText.trim()}
                    className="p-3 bg-white/10 hover:bg-white/20 backdrop-blur-xl rounded-full border border-white/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:scale-105"
                    title="Send feedback"
                  >
                    <Send className="w-5 h-5" strokeWidth={1.5} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Nickname Modal */}
        {showNicknameModal && (
          <div 
            className={`fixed inset-0 bg-black/60 backdrop-blur-lg flex items-center justify-center z-50 p-4 ${isClosingAuth ? 'animate-modal-backdrop-out' : 'animate-modal-backdrop'}`}
            onClick={() => {
              setShowNicknameModal(false);
              setNicknameInput('');
            }}
          >
            <div 
              className={`relative ${isClosingAuth ? 'animate-modal-content-out' : 'animate-modal-content'}`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal */}
              <div className="relative bg-white/[0.05] backdrop-blur-2xl rounded-2xl p-9 max-w-lg w-full border border-white/10 shadow-2xl">
                <button 
                  onClick={() => {
                    setShowNicknameModal(false);
                    setNicknameInput('');
                  }}
                  className="absolute top-6 right-6 p-1.5 text-white/30 hover:text-white/60 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>

                <div className="mb-7">
                  <h2 className="text-2xl font-medium text-white/95 mb-2 tracking-tight">set a nickname</h2>
                  <p className="text-sm text-white/40 font-light">pick a nickname to show instead of your email</p>
                </div>

                <div className="mb-7 relative">
                  <input
                    type="text"
                    value={nicknameInput}
                    onChange={(e) => setNicknameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSaveNickname();
                      }
                    }}
                    placeholder="what should we call you?"
                    maxLength={16}
                    className="w-full px-5 py-3.5 pr-12 bg-white/[0.05] border border-white/15 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-400/40 focus:bg-white/[0.08] transition-all text-base font-light tracking-wide backdrop-blur-sm"
                    autoFocus
                  />
                  
                  {/* Emoji dropdown button */}
                  <div className="absolute right-3 top-1/2 -translate-y-1/2" ref={emojiDropdownRef}>
                    <button
                      onClick={() => setShowEmojiDropdown(!showEmojiDropdown)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all group"
                      title="Add emoji"
                    >
                      <span className="text-sm opacity-50 group-hover:opacity-80 transition-opacity">😊</span>
                    </button>

                    {/* Emoji dropdown */}
                    {showEmojiDropdown && (
                      <div className="absolute bottom-full right-0 mb-2 bg-white/[0.15] backdrop-blur-xl rounded-xl border border-white/20 shadow-2xl p-2 w-48 max-h-64 overflow-y-auto z-50">
                        <div className="grid grid-cols-4 gap-1">
                          {popularEmojis.map((emoji, idx) => (
                            <button
                              key={idx}
                              onClick={() => insertEmoji(emoji)}
                              className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-white/15 transition-colors text-xl"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => {
                      setShowNicknameModal(false);
                      setNicknameInput('');
                    }}
                    className="px-5 py-2.5 text-sm text-white/50 hover:text-white/70 transition-colors font-light tracking-wide"
                  >
                    cancel
                  </button>
                  <button
                    onClick={handleSaveNickname}
                    disabled={!nicknameInput.trim()}
                    className="px-6 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-purple-500/80 to-blue-500/80 hover:from-purple-500 hover:to-blue-500 rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:from-purple-500/80 disabled:hover:to-blue-500/80 border border-purple-400/20 hover:border-purple-400/40 backdrop-blur-sm"
                  >
                    save
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto">
            {/* Home Screen - Initial State */}
            {(!hasResult || isClosingResults) && !isListening && !isProcessing && (
              <div 
                className="flex flex-col items-center"
                style={{
                  opacity: (!hasResult && !isClosingResults) ? 1 : 0,
                  transform: (!hasResult && !isClosingResults) ? 'translateY(0) translateZ(0)' : 'translateY(10px) translateZ(0)',
                  transition: isHomepageAnimating ? 'opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1), transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)' : 'opacity 0.3s ease-out, transform 0.3s ease-out',
                  willChange: 'transform, opacity',
                  backfaceVisibility: 'hidden',
                  pointerEvents: (!hasResult && !isClosingResults) ? 'auto' : 'none'
                }}
              >
                <h1 className="text-5xl font-bold text-white text-center mb-12 mt-20">
                  tap to hummm
                </h1>

                <button
                  onClick={startRecording}
                  className={`relative group mb-8 ${
                    searchCount >= FREE_SEARCH_LIMIT && userTier === 'free'
                      ? 'opacity-50 cursor-not-allowed' 
                      : ''
                  }`}
                >
                  <div className="absolute inset-0 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: 'rgba(216, 181, 254, 0.3)' }}></div>
                  
                  <div className="relative w-48 h-48 rounded-full bg-gradient-to-br from-white/5 to-white/[0.02] backdrop-blur-sm border-2 border-white/20 flex items-center justify-center transition-all duration-300 group-hover:scale-105 group-hover:border-white/40">
                    <img 
                      src={hummingBirdIcon} 
                      alt="Hummingbird" 
                      className="w-24 h-24 object-contain"
                    />
                  </div>
                </button>

                {/* Out of Searches Error */}
                {outOfSearchesError && (
                  <div className="mb-8 animate-fade-in-up">
                    <div className="relative">
                      <div className="absolute inset-0 bg-gradient-to-br from-rose-500/20 to-orange-500/20 rounded-2xl blur-xl"></div>
                      <div className="relative bg-gradient-to-br from-rose-500/10 to-orange-500/10 backdrop-blur-xl rounded-2xl p-6 border border-rose-500/30">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-3xl">😔</span>
                          <h3 className="text-xl font-bold text-rose-300">Out of searches</h3>
                        </div>
                        <p className="text-white/70 text-sm">
                          Upgrade to keep humming!
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <p className="text-2xl text-white/80 mb-6">or</p>

                <div className="w-full max-w-md mb-16">
                  <div className="relative">
                    <div className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center z-10">
                      <img 
                        src={sparkleIcon} 
                        alt="Sparkle" 
                        className="w-full h-full opacity-60"
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="smart search with lyrics..."
                      value={lyricsInput}
                      onChange={(e) => setLyricsInput(e.target.value)}
                      onKeyPress={handleLyricsKeyPress}
                      onClick={() => {
                        // If disabled due to being out of searches, show appropriate modal
                        if (!user && anonymousSearchCount >= ANONYMOUS_SEARCH_LIMIT) {
                          setShowAuthModal(true);
                        } else if (user && userTier === 'free' && searchCount >= FREE_SEARCH_LIMIT) {
                          setShowUpgradeModal(true);
                        }
                      }}
                      disabled={isSearchingLyrics}
                      className="w-full bg-white/10 backdrop-blur-sm border border-white/20 focus:border-purple-400/30 rounded-full py-4 pl-14 pr-14 text-white placeholder-white/50 focus:outline-none transition-all disabled:opacity-50"
                    />
                    
                    {/* Loading spinner OR Submit arrow */}
                    {isSearchingLyrics ? (
                      <div className="absolute right-5 top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8">
                        <div className="relative w-5 h-5">
                          <div className="absolute top-1/2 left-1/2 w-1.5 h-1.5 bg-white/70 rounded-full" style={{ animation: 'dotRotate 1.2s linear infinite', animationDelay: '0s' }}></div>
                          <div className="absolute top-1/2 left-1/2 w-1.5 h-1.5 bg-white/70 rounded-full" style={{ animation: 'dotRotate 1.2s linear infinite', animationDelay: '0.4s' }}></div>
                          <div className="absolute top-1/2 left-1/2 w-1.5 h-1.5 bg-white/70 rounded-full" style={{ animation: 'dotRotate 1.2s linear infinite', animationDelay: '0.8s' }}></div>
                        </div>
                      </div>
                    ) : lyricsInput.trim() && (
                      <button
                        onClick={searchByLyrics}
                        className="absolute right-5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 border border-white/20 hover:border-white/40 transition-all group"
                        title="Search"
                      >
                        <Send className="w-4 h-4 text-white/60 group-hover:text-white/90 transition-colors" strokeWidth={2} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="w-full max-w-md">
                  <h2 className="text-lg font-bold text-white mb-4">recent searches</h2>
                  <div className="space-y-3">
                    {(() => {
                      // Check if user has a token (might be logged in but user state not set yet)
                      const hasToken = localStorage.getItem('hum-auth-token');
                      // Only show defaultSearches if user is definitely not logged in (no token AND no user)
                      const shouldShowDefaults = !hasToken && !user && recentSearches.length === 0;
                      const searchesToShow = recentSearches.length > 0 ? recentSearches : (shouldShowDefaults ? defaultSearches : []);
                      return searchesToShow.slice(0, showAllSearches ? 8 : 3);
                    })().map((search, idx) => (
                        <div 
                          key={idx} 
                          className="bg-white/5 backdrop-blur-sm rounded-2xl p-4 hover:bg-white/10 transition-all cursor-pointer border border-white/10 flex items-center justify-between"
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-14 h-14 bg-white/10 rounded-lg overflow-hidden flex-shrink-0">
                              {search.albumArt ? (
                                <img 
                                  src={search.albumArt} 
                                  alt={search.song}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Music className="w-6 h-6 opacity-40" />
                                </div>
                              )}
                            </div>
                            
                            <div>
                              <p className="font-bold text-white mb-1">{search.song}</p>
                              <p className="text-sm text-white/60 font-medium">{search.artist}</p>
                            </div>
                          </div>

                          <span className="text-sm text-white/40 ml-4">
                            {search.timestamp ? getRelativeTime(search.timestamp) : search.time}
                          </span>
                        </div>
                      ))}
                  </div>
                  
                  {/* Show More/Less Button */}
                  {(() => {
                    const hasToken = localStorage.getItem('hum-auth-token');
                    const shouldShowDefaults = !hasToken && !user && recentSearches.length === 0;
                    const totalSearches = recentSearches.length || (shouldShowDefaults ? defaultSearches.length : 0);
                    return totalSearches > 3;
                  })() && (
                    <button
                      onClick={() => setShowAllSearches(!showAllSearches)}
                      className="w-full mt-3 py-3 text-sm text-white/60 hover:text-white/80 hover:bg-white/5 rounded-2xl transition-all border border-white/10 hover:border-white/20"
                    >
                      {(() => {
                        const hasToken = localStorage.getItem('hum-auth-token');
                        const shouldShowDefaults = !hasToken && !user && recentSearches.length === 0;
                        const totalSearches = recentSearches.length || (shouldShowDefaults ? defaultSearches.length : 0);
                        return showAllSearches ? 'show less' : `show more (${Math.min(totalSearches - 3, 7)} more)`;
                      })()}
                    </button>
                  )}
                </div>

                {/* Support Button */}
                <div className="w-full max-w-md mt-12 text-center">
                  <p className="text-white/60 mb-4">enjoying hüm?</p>
                  <a
                    href="https://ko-fi.com/otizzle"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 backdrop-blur-sm rounded-full border border-white/10 hover:border-white/20 transition-all group"
                  >
                    <span className="text-sm font-medium">buy me a coffee</span>
                    <span className="text-lg">☕</span>
                  </a>
                </div>

                {error && (
                  <div className="mt-8 bg-red-500/10 border border-red-500/20 rounded-2xl p-4 flex items-center gap-3">
                    <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                    <p className="text-red-200">{error}</p>
                  </div>
                )}
              </div>
            )}

            {/* Listening State */}
            {isListening && (
              <div className="flex flex-col items-center justify-center min-h-[70vh]">
                <div className="relative mb-8">
                  <div className="absolute inset-0 rounded-full blur-3xl animate-pulse" style={{ background: 'rgba(216, 181, 254, 0.3)' }}></div>
                  <div className="relative w-48 h-48 rounded-full bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-sm border-2 border-white/20 flex items-center justify-center">
                    <img 
                      src={hummingBirdIcon} 
                      alt="Listening" 
                      className="w-24 h-24 object-contain animate-float"
                    />
                  </div>
                </div>
                
                <h2 className="text-3xl font-bold mb-4 text-center">listening...</h2>
                <p className="text-white/60 text-center mb-8">hum or sing the melody clearly</p>
                
                <div className="w-64 bg-white/5 rounded-full h-2 overflow-hidden">
                  <div 
                    className="h-full rounded-full transition-all duration-300 ease-out"
                    style={{ background: '#D8B5FE', width: `${audioLevel}%` }}
                  ></div>
                </div>
              </div>
            )}

            {/* Processing State - only show if we don't have results yet */}
            {(isProcessing || isSearchingLyrics) && !hasResult && (
              <div className="flex flex-col items-center justify-center min-h-[70vh]">
                <div className="flex gap-3 mb-8">
                  <div 
                    className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-400 to-purple-400 animate-wave"
                    style={{ animationDelay: '0s' }}
                  ></div>
                  <div 
                    className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-400 to-purple-400 animate-wave"
                    style={{ animationDelay: '0.2s' }}
                  ></div>
                  <div 
                    className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-400 to-purple-400 animate-wave"
                    style={{ animationDelay: '0.4s' }}
                  ></div>
                </div>
                
                <h2 className="text-3xl font-bold mb-4 text-center">
                  {isSearchingLyrics ? 'searching...' : 'identifying...'}
                </h2>
                <p className="text-white/60 text-center">
                  {isSearchingLyrics ? 'looking through lyrics' : 'nesting through our database'}
                </p>
              </div>
            )}

            {/* Results State */}
            {hasResult && matchData && (
              <div 
                className="py-8"
                style={{
                  opacity: isClosingResults ? 0 : 1,
                  transform: isClosingResults ? 'translateY(20px) translateZ(0)' : 'translateY(0) translateZ(0)',
                  transition: 'opacity 0.4s ease-out, transform 0.4s ease-out',
                  willChange: 'opacity, transform',
                  pointerEvents: isClosingResults ? 'none' : 'auto'
                }}
              >
                <div className="text-center mb-12">
                  <button 
                    onClick={handleResetApp}
                    className="group inline-flex items-center justify-center w-20 h-20 rounded-full bg-white/5 border border-white/20 mb-6 hover:border-[#D8B5FE]/40 hover:scale-105 transition-all cursor-pointer relative"
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(216, 181, 254, 0.3)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                    }}
                  >
                    <img 
                      src={hummingBirdIcon} 
                      alt="Home" 
                      className="w-12 h-12 object-contain"
                    />
                    {/* Tooltip on hover */}
                    <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                      <span className="text-xs font-medium whitespace-nowrap" style={{ color: '#D8B5FE' }}>Back to home</span>
                    </div>
                  </button>
                  <div className="flex items-center justify-center gap-4 mb-4">
                    <h2 className="text-5xl font-bold tracking-wide">
                      {matchData?.[0]?.title || 'Unknown Song'}
                    </h2>
                    <button 
                      onClick={toggleSave}
                      className="p-3 hover:bg-white/5 rounded-full transition-all group"
                    >
                      <Bookmark 
                        className={`w-6 h-6 transition-all duration-200 ${bookmarkAnimating ? 'animate-bookmark-pulse' : ''} ${isSaved ? 'text-white/40 group-hover:text-white/60' : 'text-white/40 group-hover:text-white/60'}`}
                        style={isSaved ? { fill: '#D8B5FE', color: '#D8B5FE' } : {}} 
                        strokeWidth={1.5} 
                      />
                    </button>
                  </div>
                  <p className="text-xl text-white/60 font-medium">
                    {matchData?.[0]?.artist || 'Unknown Artist'}
                  </p>
                  
                  <div className="flex items-center justify-center gap-4 mt-6">
                    {matchData?.[0]?.spotify?.popularity && (
                      <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-500/10 rounded-full border border-green-500/20">
                        <span className="text-sm text-green-400">
                          🎵 Spotify Popularity: {matchData[0].spotify.popularity}/100
                        </span>
                      </div>
                    )}
                    
                    <button
                      onClick={() => setShowGeneralFeedback(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm transition-all border border-white/10"
                    >
                      <ThumbsDown className="w-4 h-4" strokeWidth={1.5} />
                      Wrong song? Help us learn
                    </button>
                  </div>
                </div>

                <div className="relative mb-12 group">
                  <div className="absolute inset-0 rounded-3xl blur-2xl opacity-50 group-hover:opacity-70 transition-opacity" style={{ background: 'rgba(216, 181, 254, 0.3)' }}></div>
                  <div className="relative bg-gradient-to-br from-white/5 to-white/[0.02] backdrop-blur-sm rounded-3xl aspect-square flex items-center justify-center border border-white/10 overflow-hidden">
                    {matchData?.[0]?.spotify?.album_art ? (
                      <img 
                        src={matchData[0].spotify.album_art} 
                        alt={`${matchData[0].title} album art`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Music className="w-32 h-32 opacity-20" strokeWidth={1} />
                    )}
                  </div>
                </div>

                <div className="bg-white/[0.02] backdrop-blur-sm rounded-2xl p-8 mb-8 border border-white/5">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm text-white/40 tracking-wide uppercase text-xs">Confidence</span>
                    <span className="text-2xl font-bold">{matchData?.[0]?.confidence || 0}%</span>
                  </div>
                  <div className="w-full bg-white/5 rounded-full h-1 overflow-hidden">
                    <div 
                      className="h-full rounded-full transition-all duration-1000"
                      style={{ background: '#D8B5FE' }} 
                      style={{ width: `${matchData?.[0]?.confidence || 0}%` }}
                    ></div>
                  </div>
                </div>

                {matchData && matchData.length > 1 && (
                  <div className="mb-8">
                    <h3 className="text-sm tracking-widest uppercase text-white/30 mb-4 font-bold">Other Possible Matches</h3>
                    <div className="space-y-3">
                      {matchData.slice(1).map((song, idx) => {
                        // Handle separator
                        if (song.isSeparator) {
                          return (
                            <div key={`separator-${idx}`} className="flex items-center gap-4 py-2">
                              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
                              <span className="text-xs text-white/40 font-medium">{song.label}</span>
                              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
                            </div>
                          );
                        }
                        
                        return (
                          <div key={idx}>
                            {/* Show interpretation label if it exists and it's the first of its type */}
                            {song.interpretationLabel && idx > 0 && matchData[idx].interpretationLabel !== matchData[idx - 1]?.interpretationLabel && (
                              <div className="mb-2 mt-4">
                                <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/10">
                                  <span className="text-xs text-white/60">{song.interpretationLabel}</span>
                                </div>
                              </div>
                            )}
                            
                            <div 
                              onClick={() => {
                                // Filter out separators when reordering
                                const realSongs = matchData.filter(s => !s.isSeparator);
                                const clickedSong = realSongs.find(s => 
                                  s.title === song.title && s.artist === song.artist
                                );
                                const otherSongs = realSongs.filter(s => 
                                  s.title !== song.title || s.artist !== song.artist
                                );
                                const newMatches = [clickedSong, ...otherSongs];
                                setMatchData(newMatches);
                              }}
                              className={`bg-white/[0.02] backdrop-blur-sm rounded-2xl p-5 hover:bg-white/[0.04] transition-all cursor-pointer border group ${
                                song.isAlternative ? 'border-green-500/20 bg-green-500/5' : 'border-white/5'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                  <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center border border-white/5 group-hover:bg-white/10 transition-colors overflow-hidden">
                                    {song.spotify?.album_art ? (
                                      <img 
                                        src={song.spotify.album_art} 
                                        alt={`${song.title} album art`}
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <Music className="w-5 h-5 opacity-40" strokeWidth={1} />
                                    )}
                                  </div>
                                  <div>
                                    <p className="font-bold mb-0.5">{song.title}</p>
                                    <p className="text-sm text-white/60 font-medium">{song.artist}</p>
                                  </div>
                                </div>
                                <span className="text-sm text-white/40 font-bold">{song.confidence}%</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 mb-8">
                  {matchData?.[0]?.spotify?.external_url || matchData?.[0]?.externalIds?.spotify ? (
                    <a 
                      href={
                        matchData[0].spotify?.external_url || 
                        `https://open.spotify.com/track/${matchData[0].externalIds.spotify}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-gradient-to-r from-green-500/10 to-green-600/10 hover:from-green-500/20 hover:to-green-600/20 transition-all py-5 rounded-2xl font-bold tracking-wide border border-green-500/20 text-center"
                    >
                      🎵 Open in Spotify
                    </a>
                  ) : (
                    <button className="bg-white/[0.02] backdrop-blur-sm py-5 rounded-2xl font-bold tracking-wide border border-white/5 opacity-50 cursor-not-allowed">
                      Spotify Unavailable
                    </button>
                  )}
                  <button className="bg-white/[0.02] backdrop-blur-sm hover:bg-white/5 transition-all py-5 rounded-2xl font-bold tracking-wide border border-white/5 flex items-center justify-center gap-2">
                    <Share2 className="w-4 h-4" strokeWidth={1.5} />
                    Share
                  </button>
                </div>

                {matchData?.[0]?.spotify?.preview_url && (
                  <div className="mb-8 bg-white/[0.02] backdrop-blur-sm rounded-2xl p-6 border border-white/5">
                    <p className="text-sm text-white/40 mb-3 uppercase tracking-wide font-bold">Preview</p>
                    <audio 
                      controls 
                      className="w-full"
                      src={matchData[0].spotify.preview_url}
                    >
                      Your browser does not support audio playback.
                    </audio>
                  </div>
                )}

                <button 
                  onClick={handleResetApp}
                    className="w-full transition-all py-5 rounded-2xl font-bold tracking-wide border border-white/10 hover:opacity-90"
                    style={{ background: 'rgba(216, 181, 254, 0.1)' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(216, 181, 254, 0.2)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(216, 181, 254, 0.1)'}
                >
                  Search Again
                </button>

                {/* Support Button - Results Page */}
                <div className="w-full mt-8 text-center">
                  <p className="text-white/60 mb-4">enjoying hüm?</p>
                  <a
                    href="https://ko-fi.com/otizzle"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 backdrop-blur-sm rounded-full border border-white/10 hover:border-white/20 transition-all group"
                  >
                    <span className="text-sm font-medium">buy me a coffee</span>
                    <span className="text-lg">☕</span>
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}