// Notch apple: system-wide Now Playing bridge.
// Reads what's playing in ANY app (Music, Spotify, Anghami, browsers, podcasts…)
// from macOS's MediaRemote and prints one JSON line whenever it changes.
// It runs inside /usr/bin/osascript because macOS only lets Apple's own tools
// read MediaRemote. Artwork is sent (base64) once per track.
ObjC.import('Foundation');
$.NSBundle.bundleWithPath('/System/Library/PrivateFrameworks/MediaRemote.framework/').load;
const R = $.NSClassFromString('MRNowPlayingRequest');
const out = $.NSFileHandle.fileHandleWithStandardOutput;
const u = v => { try { return (v === undefined || v === null || (v.isNil && v.isNil())) ? null : ObjC.unwrap(v); } catch (e) { return null; } };
let last = '', lastArtKey = '';
function run(argv) {
  const interval = parseFloat(argv[0] || '1');
  while (true) {
    const o = {};
    try {
      o.playing = !!R.localIsPlaying;
      const client = R.localNowPlayingPlayerPath.client;
      if (!client.isNil()) { o.bundle = u(client.bundleIdentifier); try { o.app = u(client.displayName); } catch (e) {} }
      const item = R.localNowPlayingItem;
      const i = item.isNil() ? null : item.nowPlayingInfo;
      if (i && !i.isNil()) {
        const k = n => u(i.valueForKey('kMRMediaRemoteNowPlayingInfo' + n));
        o.title = k('Title'); o.artist = k('Artist'); o.album = k('Album');
        o.duration = k('Duration'); o.elapsed = k('ElapsedTime'); o.rate = k('PlaybackRate');
        const t = i.valueForKey('kMRMediaRemoteNowPlayingInfoTimestamp');
        o.ts = t.isNil() ? null : t.timeIntervalSince1970;
        const url = i.valueForKey('kMRMediaRemoteNowPlayingInfoAssetURL');
        if (!url.isNil()) { try { o.file = u(url.lastPathComponent); } catch (e) {} }
        const artKey = [o.bundle, o.title, o.artist, o.album].join('|');
        const art = i.valueForKey('kMRMediaRemoteNowPlayingInfoArtworkData');
        if (artKey !== lastArtKey && !art.isNil()) { o.art = u(art.base64EncodedStringWithOptions(0)); lastArtKey = artKey; }
      }
    } catch (e) { o.error = String(e); }
    const line = JSON.stringify(o);
    if (line !== last || o.art) {
      last = o.art ? JSON.stringify(Object.assign({}, o, { art: undefined })) : line;
      out.writeData($(line + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
    }
    delay(interval);
  }
}
