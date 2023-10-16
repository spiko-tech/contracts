# Deploying subgraph

1. Authenticate to The Graph: `npx graph auth --product hosted-service <ACCESS_TOKEN>`
2. Build contracts from the repository root
3. Run `config/deploy.sh` (do not forget to set config file and subgraph name accordingly) 