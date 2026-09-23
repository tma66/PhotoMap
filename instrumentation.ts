// Required by this project's global Node.js convention: crash loudly on an
// unhandled rejection rather than limp along in an unknown state. launchd
// (scripts/com.travelsteps.web.plist, KeepAlive) restarts the server within
// seconds, so this is a brief blip, not downtime.
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    process.on("unhandledRejection", (reason) => {
      console.error("Unhandled Rejection:", reason);
      process.exit(1);
    });
  }
}
