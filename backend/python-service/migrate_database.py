#!/usr/bin/env python3
"""
Migration Script: Re-extract all songs with multi-feature support
Run this ONCE to upgrade your database from pitch-only to multi-feature
"""

import json
import os
import sys

def migrate_database():
    """
    This script prepares your database for multi-feature extraction.
    
    IMPORTANT: You'll need to re-add your 8 songs using the MP3 files!
    """
    
    db_path = 'song_database.json'
    
    if not os.path.exists(db_path):
        print("❌ song_database.json not found!")
        return
    
    # Backup original database
    backup_path = 'song_database_backup.json'
    print(f"📦 Backing up database to {backup_path}...")
    
    with open(db_path, 'r') as f:
        database = json.load(f)
    
    with open(backup_path, 'w') as f:
        json.dump(database, f, indent=2)
    
    print(f"✅ Backup saved!")
    print(f"\n📊 Current database:")
    print(f"   Songs: {len(database)}")
    
    for song_id, song_data in database.items():
        variant_count = len(song_data.get('variants', []))
        print(f"   - {song_data.get('title')}: {variant_count} variants")
    
    print(f"\n" + "="*60)
    print("🔄 MIGRATION REQUIRED")
    print("="*60)
    print("""
To use multi-feature matching (Solution 3), you need to:

1. Keep your original MP3 files in: training-data/songs/
   
2. Re-add each song using the NEW melody_matcher_v3.py:
   
   python3 add_songs_v3.py

This will:
✅ Extract pitch (like before)
✅ Extract rhythm patterns (NEW!)
✅ Extract tempo/BPM (NEW!)
✅ Preserve your existing variants
✅ Enable much better matching!

Your variants will be preserved but will work with old pitch-only
comparison until you re-collect them.

Ready to proceed? Your backup is safe in song_database_backup.json
""")
    
    response = input("Type 'yes' to mark database as ready for migration: ")
    
    if response.lower() == 'yes':
        # Add migration flag
        for song_id in database:
            database[song_id]['needs_migration'] = True
        
        with open(db_path, 'w') as f:
            json.dump(database, f, indent=2)
        
        print("✅ Database marked for migration!")
        print("📝 Next step: Run add_songs_v3.py to re-add your songs")
    else:
        print("❌ Migration cancelled")

if __name__ == '__main__':
    migrate_database()
