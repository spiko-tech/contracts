# Deploying subgraph

1. Authenticate to The Graph: `npx graph auth --studio <ACCESS_TOKEN>`
2. Build contracts from the repository root (if they aren't yet built)
3. Modify `config/dev-network.json` accordingly to set addresses, start blocks, etc.
4. Run `config/deploy.sh vx.y.z` by precising a version for the subgraph as argument
