import requests
import os
import sys

def add_song_from_file(song_id, title, artist, audio_path):
    """Add a song to the database"""
    if not os.path.exists(audio_path):
        print(f"❌ File not found: {audio_path}")
        return False
    
    url = 'http://localhost:5001/add-song'
    
    print(f"Adding: {title} by {artist}...")
    
    try:
        with open(audio_path, 'rb') as f:
            files = {'audio': f}
            data = {
                'song_id': song_id,
                'title': title,
                'artist': artist
            }
            
            response = requests.post(url, files=files, data=data, timeout=60)
            result = response.json()
            
            if result.get('success'):
                print(f"✅ Added successfully!")
                return True
            else:
                print(f"❌ Failed: {result.get('error')}")
                return False
                
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

def check_server():
    """Check if melody matcher is running"""
    try:
        response = requests.get('http://localhost:5001/health', timeout=5)
        return response.status_code == 200
    except:
        return False

if __name__ == '__main__':
    if not check_server():
        print("❌ Melody matcher service is not running!")
        print("Start it with: python3 melody_matcher.py")
        sys.exit(1)
    
    print("✅ Server is running\n")
    
    # Example songs - YOU WILL EDIT THIS LIST
    songs = [
        # (song_id, title, artist, path_to_audio_file)
        ('blinding_lights', 'Blinding Lights', 'The Weeknd', '../training-data/songs/The Weeknd - Blinding Lights (Official Audio).mp3'),
        ('shape_of_you', 'Shape of You', 'Ed Sheeran', '../training-data/songs/Ed Sheeran - Shape of You (Official Music Video).mp3'),
        ('levitating', 'Levitating', 'Dua Lipa', '../training-data/songs/Dua Lipa - Levitating Featuring DaBaby (Official Music Video).mp3'),
        ('espresso', 'Espresso', 'Sabrina Carpenter', '../training-data/songs/Sabrina Carpenter - Espresso.mp3'),
        ('not_like_us', 'Not Like Us', 'Kendrick Lamar', '../training-data/songs/Kendrick Lamar - Not Like Us [H58vbez_m4E].mp3'),
        ('a_bar_song', 'A Bar Song (Tipsy)', 'Shaboozey', '../training-data/songs/Shaboozey - A Bar Song (Tipsy) [Official Visualizer].mp3'),
        ('tell_ur_girlfriend', 'Tell Ur Girlfriend', 'Lay Bankz', '../training-data/songs/Lay Bankz - Tell Ur Girlfriend (Official Video).mp3'),
        ('show_me_love', 'Show Me Love', 'WizTheMc', '../training-data/songs/WizTheMc, bees & honey - Show Me Love (Official Music Video).mp3'),
    ]
    
    if len(songs) == 0:
        print("⚠️  No songs configured yet!")
        print("\nEdit add_songs.py and add songs to the 'songs' list.")
        print("Example:")
        print("  ('song_id', 'Song Title', 'Artist Name', '../training-data/songs/file.mp3')")
        sys.exit(0)
    
    print(f"Adding {len(songs)} songs...\n")
    
    success_count = 0
    for song_id, title, artist, path in songs:
        if add_song_from_file(song_id, title, artist, path):
            success_count += 1
        print()
    
    print(f"\n✅ Successfully added {success_count}/{len(songs)} songs")
    
    # Check final count
    response = requests.get('http://localhost:5001/stats')
    stats = response.json()
    print(f"📚 Total songs in database: {stats['total_songs']}")