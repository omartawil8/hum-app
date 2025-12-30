#!/usr/bin/env python3
"""
Add songs to database with MULTI-FEATURE extraction (Solution 3)
This replaces the old add_songs.py
"""

import sys
import os

# Add parent directory to path to import melody_matcher_v3
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import the NEW multi-feature matcher
from melody_matcher_v3 import MelodyMatcher

def add_songs_from_directory(songs_dir='../training-data/songs'):
    """
    Add all MP3s from training-data/songs/ directory
    Will extract: pitch + rhythm + tempo
    """
    
    matcher = MelodyMatcher()
    
    if not os.path.exists(songs_dir):
        print(f"❌ Directory not found: {songs_dir}")
        print(f"   Please create it and add your MP3 files there")
        return
    
    # Get all MP3 files
    mp3_files = [f for f in os.listdir(songs_dir) if f.endswith('.mp3')]
    
    if not mp3_files:
        print(f"❌ No MP3 files found in {songs_dir}")
        return
    
    print(f"🎵 Found {len(mp3_files)} MP3 files")
    print("="*60)
    
    for mp3_file in mp3_files:
        file_path = os.path.join(songs_dir, mp3_file)
        
        # Generate song_id from filename
        song_id = mp3_file.replace('.mp3', '').lower().replace(' ', '_').replace('-', '_')
        
        # Ask for title and artist
        print(f"\n📀 File: {mp3_file}")
        
        # Check if song already exists
        if song_id in matcher.song_database:
            print(f"⚠️  Song '{song_id}' already exists in database")
            response = input("   Re-extract with new features? (yes/no): ")
            if response.lower() != 'yes':
                print("   Skipped!")
                continue
            else:
                # Preserve existing variants
                old_variants = matcher.song_database[song_id].get('variants', [])
                print(f"   Preserving {len(old_variants)} existing variants...")
        else:
            old_variants = []
        
        title = input("   Song title: ")
        artist = input("   Artist: ")
        
        if not title or not artist:
            print("   ❌ Skipped (no title/artist provided)")
            continue
        
        print(f"   🔄 Extracting features (pitch + rhythm + tempo)...")
        
        result = matcher.add_song(song_id, title, artist, file_path)
        
        if result['success']:
            # Restore variants if any
            if old_variants:
                matcher.song_database[song_id]['variants'] = old_variants
                matcher.save_database()
                print(f"   ✅ Added with {len(old_variants)} preserved variants!")
            else:
                print(f"   ✅ Added successfully!")
        else:
            print(f"   ❌ Failed: {result.get('error')}")
    
    print("\n" + "="*60)
    print(f"✅ Database updated!")
    print(f"📊 Total songs: {len(matcher.song_database)}")
    
    # Show what got migrated
    print(f"\n🎵 Songs with full features:")
    for song_id, song_data in matcher.song_database.items():
        has_features = 'features' in song_data
        variant_count = len(song_data.get('variants', []))
        status = "✅ Full features" if has_features else "⚠️  Pitch only"
        print(f"   - {song_data.get('title')}: {status} ({variant_count} variants)")

def interactive_add():
    """Add a single song interactively"""
    matcher = MelodyMatcher()
    
    print("🎵 Add a song to database (with rhythm + tempo extraction)")
    print("="*60)
    
    mp3_path = input("Path to MP3 file: ")
    
    if not os.path.exists(mp3_path):
        print(f"❌ File not found: {mp3_path}")
        return
    
    song_id = input("Song ID (e.g., 'blinding_lights'): ").lower().replace(' ', '_')
    title = input("Song title: ")
    artist = input("Artist: ")
    
    print(f"\n🔄 Extracting features...")
    result = matcher.add_song(song_id, title, artist, mp3_path)
    
    if result['success']:
        print(f"✅ Added '{title}' by {artist}!")
    else:
        print(f"❌ Failed: {result.get('error')}")

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--interactive':
        interactive_add()
    else:
        # Default: batch add from directory
        songs_dir = '../training-data/songs'
        if len(sys.argv) > 1:
            songs_dir = sys.argv[1]
        add_songs_from_directory(songs_dir)
