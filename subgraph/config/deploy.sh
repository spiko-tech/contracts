#!/usr/bin/env bash

set -xo errexit

configs=config/*.json

for config in $configs;
do
  subgraph=$(jq -r '.output' $config)
  npx graph-compiler --config ${config} --include src/datasources --include node_modules/@openzeppelin/subgraphs/src/datasources --export-schema --export-subgraph
  npx graph codegen ${subgraph}subgraph.yaml

  echo "the config is "$config

  jq -cr '.deploy[].type+" "+.deploy[].name' $config | while read endpoint;
  do
    if [[ ! -z ${endpoint} ]]; then 
      npx graph deploy --product ${endpoint} ${subgraph}subgraph.yaml --version-label=$1
    fi
  done
done
