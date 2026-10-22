const hre = require("hardhat");

const EVENT_NAMES = [
  "MANUFACTURED",
  "PACKAGED",
  "TRANSIT",
  "WAREHOUSE_RECEIVED",
  "DISTRIBUTOR_RECEIVED",
  "RETAILER_RECEIVED",
  "VERIFIED_GENUINE",
  "FLAGGED_FAKE",
  "DISPATCHED"
];

const VERDICT_NAMES = ["NONE", "REAL", "FAKE"];

async function main() {
  const batchId = process.env.SUPPLYGUARD_BATCH_ID || "SG-BATCH-001";
  const address = process.env.SUPPLYGUARD_CONTRACT_ADDRESS;
  if (!address) {
    throw new Error("SUPPLYGUARD_CONTRACT_ADDRESS is required");
  }

  const [signer] = await hre.ethers.getSigners();
  const ledger = await hre.ethers.getContractAt("SupplyGuardLedger", address, signer);

  const batch = await ledger.getBatch(batchId);
  if (!batch.batchId || batch.batchId === "") {
    console.log(JSON.stringify({ exists: false, batch_id: batchId, records: [] }));
    return;
  }

  const history = await ledger.getBatchHistory(batchId);
  const records = history.map((record, index) => {
    const eventType = Number(record.eventType);
    const verdict = Number(record.verdict);
    const confidenceBps = Number(record.confidenceBps);
    return {
      index: index + 1,
      recordId: record.recordId,
      eventType: EVENT_NAMES[eventType] || `EVENT_${eventType}`,
      actor: record.actor,
      timestamp: Number(record.timestamp),
      formattedTime: new Date(Number(record.timestamp) * 1000).toISOString(),
      location: record.location,
      dataHash: record.dataHash,
      verdict: VERDICT_NAMES[verdict] || "NONE",
      confidenceBps: confidenceBps,
      confidencePercent: (confidenceBps / 100).toFixed(2),
      notes: record.notes,
      previousRecordId: record.previousRecordId
    };
  });

  console.log(
    JSON.stringify({
      exists: true,
      batch_id: batch.batchId,
      product_id: batch.productId,
      manufacturer: batch.manufacturer,
      created_at: Number(batch.createdAt),
      is_closed: batch.isClosed,
      total_records: Number(batch.totalRecords),
      records: records
    })
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
