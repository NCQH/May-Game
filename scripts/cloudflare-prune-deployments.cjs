// Keep the newest production deployments and delete older ones.
// Usage: CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/cloudflare-prune-deployments.cjs [project] [keep]
const API = "https://api.cloudflare.com/client/v4";

function selectDeployments(deployments, keep = 2) {
  const sorted = [...deployments].sort((a, b) => String(b.created_on || "").localeCompare(String(a.created_on || "")));
  const keepIds = new Set();
  for (const deployment of sorted) {
    if (deployment.environment === "production" && keepIds.size < keep) keepIds.add(deployment.id);
  }
  return sorted.filter((deployment) => !keepIds.has(deployment.id));
}

async function listDeployments(account, token, project) {
  const deployments = [];
  for (let page = 1; ; page++) {
    const response = await fetch(`${API}/accounts/${account}/pages/projects/${encodeURIComponent(project)}/deployments?page=${page}&per_page=100`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json();
    if (!response.ok || !body.success) throw new Error(`Cannot list deployments: HTTP ${response.status}`);
    deployments.push(...(body.result || []));
    if (page >= (body.result_info?.total_pages || 1)) break;
  }
  return deployments;
}

async function main() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const project = process.argv[2] || "may-game";
  const keep = Number(process.argv[3] || 2);
  if (!token || !account) throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required");
  if (!Number.isInteger(keep) || keep < 1) throw new Error("keep must be a positive integer");

  const deployments = await listDeployments(account, token, project);
  const remove = selectDeployments(deployments, keep);
  if (!remove.length) {
    console.log(`Nothing to prune; keeping ${Math.min(keep, deployments.length)} production deployment(s).`);
    return;
  }

  let failed = 0;
  for (const deployment of remove) {
    const response = await fetch(`${API}/accounts/${account}/pages/projects/${encodeURIComponent(project)}/deployments/${deployment.id}?force=true`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) console.log(`Deleted ${deployment.id} (${deployment.environment}, ${deployment.created_on})`);
    else {
      failed++;
      console.warn(`Could not delete ${deployment.id}: HTTP ${response.status}`);
    }
  }
  if (failed) console.warn(`${failed} deployment(s) could not be deleted; the next release retries.`);
}

module.exports = { selectDeployments };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
