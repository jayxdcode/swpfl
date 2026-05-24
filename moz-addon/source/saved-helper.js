// content.js or wherever saveItem is
function saveItem({ title, artist, album, lrc, translation, romanization }) {
  browser.storage.local.get("savedItems").then((data) => {
    let items = data.savedItems || [];
    items.push({
      title,
      artist,
      album,
      lrc,
      translation,
      romanization,
      timestamp: Date.now(),
    });
    browser.storage.local.set({ savedItems: items });
  });
}