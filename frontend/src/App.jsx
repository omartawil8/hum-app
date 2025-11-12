import React, { useState, useEffect, useRef } from 'react';
import { Mic, Music, Volume2, Clock, Share2, Bookmark, AlertCircle } from 'lucide-react';

export default function HumApp() {
  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [hasResult, setHasResult] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [matchData, setMatchData] = useState(null);
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [savedSongs, setSavedSongs] = useState([]);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  
  const [recentSearches] = useState([
    { song: "Clair de Lune", artist: "Claude Debussy", time: "2m ago" },
    { song: "Nocturne Op. 9 No. 2", artist: "Frédéric Chopin", time: "1h ago" },
    { song: "The Four Seasons", artist: "Antonio Vivaldi", time: "3h ago" }
  ]);

  useEffect(() => {
    const saved = localStorage.getItem('hum-saved-songs');
    if (saved) {
      setSavedSongs(JSON.parse(saved));
    }
  }, []);

  useEffect(() => {
    if (matchData) {
      const isSongSaved = savedSongs.some(
        song => song.title === matchData.title && song.artist === matchData.artist
      );
      setIsSaved(isSongSaved);
    }
  }, [matchData, savedSongs]);

  useEffect(() => {
    if (isListening) {
      const interval = setInterval(() => {
        setAudioLevel(Math.random() * 100);
      }, 100);
      return () => clearInterval(interval);
    } else {
      setAudioLevel(0);
    }
  }, [isListening]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        } 
      });
      
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm'
      });
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { 
          type: 'audio/webm' 
        });
        
        stream.getTracks().forEach(track => track.stop());
        
        await identifySong(audioBlob);
      };
      
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(100);
      setIsListening(true);
      setError(null);
      
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
          setIsListening(false);
        }
      }, 15000);
      
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setError('Could not access microphone. Please allow microphone permissions.');
      setIsListening(false);
    }
  };

  const identifySong = async (audioBlob) => {
    setIsProcessing(true);
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      
      const response = await fetch('https://hum-app-production.up.railway.app/api/identify', {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      
      if (data.success) {
        setMatchData(data.song);
        setHasResult(true);
        setError(null);
      } else {
        setError(data.message || 'No match found. Try humming more clearly.');
        setHasResult(false);
        setMatchData(null);
      }
    } catch (err) {
      console.error('Error identifying song:', err);
      setError('Failed to connect to server. Make sure backend is running on port 3001.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMicClick = () => {
    if (isListening) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
        setIsListening(false);
      }
    } else {
      startRecording();
    }
  };

  const toggleSave = () => {
    const newSavedState = !isSaved;
    setIsSaved(newSavedState);
    
    if (newSavedState && matchData) {
      const updatedSongs = [...savedSongs, {
        ...matchData,
        savedAt: new Date().toISOString()
      }];
      setSavedSongs(updatedSongs);
      localStorage.setItem('hum-saved-songs', JSON.stringify(updatedSongs));
    } else {
      const updatedSongs = savedSongs.filter(
        song => !(song.title === matchData?.title && song.artist === matchData?.artist)
      );
      setSavedSongs(updatedSongs);
      localStorage.setItem('hum-saved-songs', JSON.stringify(updatedSongs));
    }
  };

  const resetApp = () => {
    setHasResult(false);
    setIsListening(false);
    setIsSaved(false);
    setMatchData(null);
    setError(null);
    setIsProcessing(false);
  };

  return (
    <div className="min-h-screen bg-black text-white font-sans relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-black via-rose-950/20 to-orange-950/30">
        <div className="absolute inset-0 opacity-60" 
             style={{
               backgroundImage: 'radial-gradient(circle at 30% 20%, rgba(255, 100, 100, 0.15) 0%, transparent 50%), radial-gradient(circle at 70% 80%, rgba(255, 150, 100, 0.15) 0%, transparent 50%)',
               filter: 'blur(60px)'
             }}>
        </div>
      </div>

      <div className="relative z-10">
        <div className="px-8 py-12">
          <div className="flex items-center justify-between max-w-5xl mx-auto">
            <h1 className="text-4xl font-light tracking-wider">hüm</h1>
            <button className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <Clock className="w-5 h-5 opacity-60" />
            </button>
          </div>
        </div>

        <div className="px-8 pb-16">
          <div className="max-w-5xl mx-auto">
            
            {!hasResult ? (
              <>
                <div className="text-center mb-20 mt-12">
                  <h2 className="text-2xl mb-4 font-light tracking-wide opacity-90">
                    {isListening ? "Listening" : isProcessing ? "Processing" : "Hum a melody"}
                  </h2>
                  <p className="text-white/40 text-base font-light">
                    {isListening ? "Analyzing your tune" : isProcessing ? "Identifying song..." : "Tap to begin"}
                  </p>
                </div>

                {error && (
                  <div className="max-w-md mx-auto mb-8 bg-red-500/10 border border-red-500/20 rounded-2xl p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-red-200 text-sm">{error}</p>
                  </div>
                )}

                <div className="flex justify-center mb-24">
                  <div className="relative">
                    {(isListening || isProcessing) && (
                      <>
                        <div className="absolute inset-0 animate-pulse" style={{ animationDuration: '3s' }}>
                          <div className="w-72 h-72 bg-gradient-to-br from-rose-500/20 to-orange-500/20 rounded-full blur-3xl"></div>
                        </div>
                      </>
                    )}

                    <button
                      onClick={handleMicClick}
                      disabled={isProcessing}
                      className="relative w-72 h-72 rounded-full flex items-center justify-center transition-all duration-500 border border-white/10 backdrop-blur-sm group disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{
                        background: (isListening || isProcessing)
                          ? 'linear-gradient(135deg, rgba(255, 100, 100, 0.1) 0%, rgba(255, 150, 100, 0.1) 100%)'
                          : 'rgba(255, 255, 255, 0.02)'
                      }}
                    >
                      <div className="absolute inset-4 rounded-full border border-white/5"></div>
                      <div className="absolute inset-8 rounded-full border border-white/5"></div>
                      
                      {isProcessing ? (
                        <div className="w-20 h-20 border-2 border-white/20 border-t-white/80 rounded-full animate-spin"></div>
                      ) : isListening ? (
                        <Volume2 className="w-20 h-20 opacity-80" strokeWidth={1} />
                      ) : (
                        <Mic className="w-20 h-20 opacity-60 group-hover:opacity-80 transition-opacity" strokeWidth={1} />
                      )}
                    </button>
                  </div>
                </div>

                {isListening && (
                  <div className="flex justify-center gap-1 mb-16">
                    {[...Array(30)].map((_, i) => {
                      const baseHeight = 10;
                      const variance = 40;
                      const animationDuration = 1.2 + (i % 5) * 0.2;
                      const delay = i * 0.05;
                      
                      return (
                        <div
                          key={i}
                          className="w-0.5 bg-gradient-to-t from-rose-400/80 to-orange-400/80 rounded-full"
                          style={{
                            height: `${baseHeight + (Math.sin(i * 0.5) * variance / 2) + variance / 2}px`,
                            opacity: 0.6,
                            animation: `smoothPulse ${animationDuration}s ease-in-out infinite`,
                            animationDelay: `${delay}s`,
                            transformOrigin: 'bottom'
                          }}
                        ></div>
                      );
                    })}
                  </div>
                )}
                
                <style>{`
                  @keyframes smoothPulse {
                    0%, 100% { 
                      transform: scaleY(0.4);
                    }
                    50% { 
                      transform: scaleY(1.2);
                    }
                  }
                `}</style>

                {!isListening && !isProcessing && (
                  <div className="max-w-md mx-auto text-center">
                    <p className="text-white/30 text-sm font-light leading-relaxed">
                      Hum clearly for 10–15 seconds to capture the essence of the melody
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="max-w-2xl mx-auto">
                <div className="text-center mb-16 mt-12">
                  <div className="inline-block text-xs tracking-widest text-white/40 mb-8 uppercase">
                    Match Found
                  </div>
                  <div className="flex items-center justify-center gap-4 mb-4">
                    <h2 className="text-5xl font-light tracking-wide">
                      {matchData?.title || 'Unknown Song'}
                    </h2>
                    <button 
                      onClick={toggleSave}
                      className="p-3 hover:bg-white/5 rounded-full transition-all group"
                    >
                      <Bookmark 
                        className={`w-6 h-6 transition-all ${isSaved ? 'fill-rose-400 text-rose-400' : 'text-white/40 group-hover:text-white/60'}`} 
                        strokeWidth={1.5} 
                      />
                    </button>
                  </div>
                  <p className="text-xl text-white/50 font-light">
                    {matchData?.artist || 'Unknown Artist'}
                  </p>
                </div>

                <div className="relative mb-12 group">
                  <div className="absolute inset-0 bg-gradient-to-br from-rose-500/20 to-orange-500/20 rounded-3xl blur-2xl opacity-50 group-hover:opacity-70 transition-opacity"></div>
                  <div className="relative bg-gradient-to-br from-white/5 to-white/[0.02] backdrop-blur-sm rounded-3xl aspect-square flex items-center justify-center border border-white/10">
                    <Music className="w-32 h-32 opacity-20" strokeWidth={1} />
                  </div>
                </div>

                <div className="bg-white/[0.02] backdrop-blur-sm rounded-2xl p-8 mb-8 border border-white/5">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm text-white/40 tracking-wide uppercase text-xs">Confidence</span>
                    <span className="text-2xl font-light">{matchData?.confidence || 0}%</span>
                  </div>
                  <div className="w-full bg-white/5 rounded-full h-1 overflow-hidden">
                    <div 
                      className="bg-gradient-to-r from-rose-400 to-orange-400 h-full rounded-full transition-all duration-1000" 
                      style={{ width: `${matchData?.confidence || 0}%` }}
                    ></div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-8">
                  {matchData?.externalIds?.spotify ? (
                    <a 
                      href={`https://open.spotify.com/track/${matchData.externalIds.spotify}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-white/[0.02] backdrop-blur-sm hover:bg-white/5 transition-all py-5 rounded-2xl font-light tracking-wide border border-white/5 text-center"
                    >
                      Open in Spotify
                    </a>
                  ) : (
                    <button className="bg-white/[0.02] backdrop-blur-sm py-5 rounded-2xl font-light tracking-wide border border-white/5 opacity-50 cursor-not-allowed">
                      Spotify Unavailable
                    </button>
                  )}
                  <button className="bg-white/[0.02] backdrop-blur-sm hover:bg-white/5 transition-all py-5 rounded-2xl font-light tracking-wide border border-white/5 flex items-center justify-center gap-2">
                    <Share2 className="w-4 h-4" strokeWidth={1.5} />
                    Share
                  </button>
                </div>

                <button 
                  onClick={resetApp}
                  className="w-full bg-gradient-to-r from-rose-500/10 to-orange-500/10 hover:from-rose-500/20 hover:to-orange-500/20 transition-all py-5 rounded-2xl font-light tracking-wide border border-white/10"
                >
                  Search Again
                </button>
              </div>
            )}

            {!hasResult && !isListening && !isProcessing && (
              <div className="mt-32 max-w-2xl mx-auto">
                <h3 className="text-sm tracking-widest uppercase text-white/30 mb-6 font-light">Recent</h3>
                <div className="space-y-3">
                  {recentSearches.map((search, idx) => (
                    <div key={idx} className="bg-white/[0.02] backdrop-blur-sm rounded-2xl p-5 hover:bg-white/[0.04] transition-all cursor-pointer border border-white/5 group">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center border border-white/5 group-hover:bg-white/10 transition-colors">
                            <Music className="w-5 h-5 opacity-40" strokeWidth={1} />
                          </div>
                          <div>
                            <p className="font-light mb-0.5">{search.song}</p>
                            <p className="text-sm text-white/40 font-light">{search.artist}</p>
                          </div>
                        </div>
                        <span className="text-xs text-white/20 font-light">{search.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}