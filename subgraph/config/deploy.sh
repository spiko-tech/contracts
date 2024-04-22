#!/usr/bin/env bash

set -xo errexit

configs=config/*.json

for config in $configs;
do
  subgraph=$(jq -r '.output' $config)
  pnpm graph-compiler --config ${config} --include src/datasources --include node_modules/@openzeppelin/subgraphs/src/datasources --export-schema --export-subgraph
  pnpm graph codegen ${subgraph}subgraph.yaml

  version=$(jq -cr '.version' $config)
  jq -cr '.deploy[].enabled+" "+.deploy[].type+" "+.deploy[].name' $config | while read enabled endpoint;
  do
    if [[ ! -z ${endpoint} ]] && [[ "${enabled}" == "on" ]]; then 
      pnpm graph deploy --product ${endpoint} ${subgraph}subgraph.yaml --version-label=${version}
    fi
  done
done