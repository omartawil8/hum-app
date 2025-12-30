import json
import os

def analyze_results():
    """Analyze collected results"""
    results_path = '../training-data/results.json'
    
    if not os.path.exists(results_path):
        print("No results file found")
        return
    
    with open(results_path, 'r') as f:
        results = json.load(f)
    
    if len(results) == 0:
        print("No results collected yet")
        return
    
    total = len(results)
    acr_success = sum(1 for r in results if r.get('acr_success'))
    crepe_success = sum(1 for r in results if r.get('crepe_success'))
    
    print(f"📊 RESULTS ANALYSIS")
    print(f"=" * 60)
    print(f"Total samples: {total}")
    print(f"\n🔵 ACRCloud:")
    print(f"  Success: {acr_success}/{total} ({acr_success/total*100:.1f}%)")
    print(f"  Failed: {total - acr_success}/{total}")
    
    print(f"\n🟢 CREPE Custom System:")
    print(f"  Success: {crepe_success}/{total} ({crepe_success/total*100:.1f}%)")
    print(f"  Failed: {total - crepe_success}/{total}")
    
    # Analyze ACRCloud confidence scores
    print(f"\n📈 ACRCloud Confidence Breakdown:")
    high_conf = 0
    medium_conf = 0
    low_conf = 0
    
    for result in results:
        if result.get('acr_result'):
            score = result['acr_result']['song'].get('score', 0)
            if score >= 0.85:
                high_conf += 1
            elif score >= 0.65:
                medium_conf += 1
            else:
                low_conf += 1
    
    print(f"  High confidence (≥85%): {high_conf}")
    print(f"  Medium confidence (65-84%): {medium_conf}")
    print(f"  Low confidence (<65%): {low_conf} ⚠️  Suspicious!")
    
    # Show all results with details
    print(f"\n📝 All Results:")
    for i, result in enumerate(results, 1):
        acr_status = "✅" if result.get('acr_success') else "❌"
        crepe_status = "✅" if result.get('crepe_success') else "❌"
        
        acr_song = "N/A"
        acr_score = 0
        if result.get('acr_result'):
            song_data = result['acr_result'].get('song', {})
            acr_song = f"{song_data.get('title', 'Unknown')} - {song_data.get('artists', [{}])[0].get('name', 'Unknown')}"
            acr_score = song_data.get('score', 0)
        
        crepe_song = "N/A"
        if result.get('crepe_result'):
            crepe_song = f"{result['crepe_result'].get('title', 'Unknown')} - {result['crepe_result'].get('artist', 'Unknown')}"
        
        confidence_icon = "🟢" if acr_score >= 0.85 else ("🟡" if acr_score >= 0.65 else "🔴")
        
        print(f"\n  Sample #{i}:")
        print(f"    ACR {acr_status}: {acr_song}")
        print(f"    {confidence_icon} Confidence: {int(acr_score * 100)}%")
        print(f"    CREPE {crepe_status}: {crepe_song}")

if __name__ == '__main__':
    analyze_results()