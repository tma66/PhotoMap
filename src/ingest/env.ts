// Must be the FIRST import in index.ts: ES module imports are evaluated in
// order before the importing file's own code runs, so putting the
// `loadEnvFile` call here (rather than as a plain statement in index.ts)
// guarantees .env is loaded before any other module — e.g. ../lib/db, which
// reads process.env.DATABASE_URL as soon as it's imported — gets evaluated.
process.loadEnvFile?.(".env");
