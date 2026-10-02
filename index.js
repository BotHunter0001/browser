const { searchAll } = require('./providers');

(async () => {
  const query = process.argv[2] || 'Inception';
  console.log(`🔍 Searching across all registered providers for "${query}"...\n`);
  const results = await searchAll(query);
  console.log(`Found ${results.length} result(s) across providers:\n`);
  results.slice(0, 15).forEach((r) =>
    console.log(`  [${r.providerDisplayName || r.provider}] ${r.title} (${r.year || 'N/A'}) [${r.type}]`)
  );
})().catch(console.error);
