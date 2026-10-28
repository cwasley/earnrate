// The only place the product name lives. package.json `name` and `bin` can't
// import this, so keep them in sync by hand.
export const PRODUCT_NAME = 'earnrate'
export const CLI_NAME = 'earnrate'
export const MCP_SERVER_NAME = 'earnrate'
export const CONFIG_DIR = '.earnrate' // under the home directory
export const WALLET_ENV_VAR = 'EARNRATE_WALLET'
export const MERCHANT_CACHE_ENV_VAR = 'EARNRATE_MERCHANT_CACHE'
export const LLM_ENV_VAR = 'EARNRATE_LLM'
export const LLM_MODEL_ENV_VAR = 'EARNRATE_LLM_MODEL'
export const LLM_MAX_CALLS_ENV_VAR = 'EARNRATE_LLM_MAX_CALLS'
