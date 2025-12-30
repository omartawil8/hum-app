import yt_dlp
import requests
import sys
import os

def download_and_add(youtube_url, song_id, title, artist):
    """Download from YouTube and add to database"""
    print(f"📥 Downloading: {title} by {artist}...")
    
    # Download
    ydl_opts = {
        'format': 'bestaudio/best',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
        }],
        'outtmpl': f'temp_{song_id}.%(ext)s',
        'quiet': True
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([youtube_url])
        
        audio_path = f'temp_{song_id}.mp3'
        
        # Add to database
        print(f"➕ Adding to CREPE database...")
        with open(audio_path, 'rb') as f:
            files = {'audio': f}
            data = {
                'song_id': song_id,
                'title': title,
                'artist': artist
            }
            response = requests.post('http://localhost:5001/add-song', 
                                   files=files, data=data, timeout=60)
            result = response.json()
            
            if result.get('success'):
                print(f"✅ Successfully added: {title}")
            else:
                print(f"❌ Failed: {result}")
        
        # Cleanup
        os.remove(audio_path)
        print()
        
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == '__main__':
    # Example - you'll edit these values
    songs = [
        # ('song_id', 'Title', 'Artist', 'YouTube URL')
        ('blinding_lights', 'Blinding Lights', 'The Weeknd', 'https://www.youtube.com/watch?v=4NRXx6U8ABQ'),
        ('shape_of_you', 'Shape of You', 'Ed Sheeran', 'https://www.youtube.com/watch?v=JGwWNGJdvx8'),
        # Add more here...
    ]
    
    for song_id, title, artist, url in songs:
        download_and_add(url, song_id, title, artist)
    
    # Check stats
    response = requests.get('http://localhost:5001/stats')
    stats = response.json()
    print(f"📚 Total songs in database: {stats['total_songs']}")