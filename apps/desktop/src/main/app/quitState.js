/** Tracks intentional app quit vs window close (close-to-tray). */
let quitting = false;

function markAppQuitting() {
  quitting = true;
}

function isAppQuitting() {
  return quitting;
}

module.exports = {
  markAppQuitting,
  isAppQuitting,
};
