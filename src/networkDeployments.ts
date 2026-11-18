// Verified against the deployed robin.callput.app and giwa.callput.app bundles on 2026-10-09.
// Provenance and runtime verification: docs/network-deployments.md.
export const DEPLOYMENTS = {
  "base": {
    "name": "Base",
    "chainId": 8453,
    "testnet": false,
    "siteUrl": "https://callput.app",
    "explorerUrl": "https://basescan.org",
    "rpcUrl": "https://mainnet.base.org",
    "marketDataUrl": "https://app-data-base.s3.ap-southeast-1.amazonaws.com/market-data.json",
    "contracts": {},
    "underlyings": {}
  },
  "robinhood": {
    "name": "Robinhood Chain",
    "chainId": 4663,
    "testnet": false,
    "siteUrl": "https://app.callput.app/?chain=robinhoodchain",
    "explorerUrl": "https://robinhoodchain.blockscout.com",
    "rpcUrl": "https://rpc.mainnet.chain.robinhood.com",
    "marketDataUrl": "https://app-data-robinhood.s3.ap-southeast-1.amazonaws.com/market-data.json",
    "contracts": {
      "POSITION_MANAGER": "0x426a6b482893557E58cF38de635fEbB30Fd6a3C3",
      "SETTLE_MANAGER": "0xd328D581f3Fb1Ca86D28D573bA1f17409e5112EF",
      "USDC": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      "WBTC": "0x6bac06600D220Ac5Ac281AD1f504D2Cf0F90F6e6",
      "WETH": "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
      "ROUTER": "0x0D240c1EbEeE7F74B40d6611326f5df98AB00e1B"
    },
    "underlyings": {
      "BTC": {
        "index": 1,
        "decimals": 8,
        "marketType": "CRYPTO",
        "optionsToken": "0x080084D6A1e9b6657EDc8DBa071BAa9D15Fcc500"
      },
      "ETH": {
        "index": 2,
        "decimals": 18,
        "marketType": "CRYPTO",
        "optionsToken": "0x84D4ef4062E00F78B0Ea5aaC06D7D08Ab1258B02"
      },
      "TSLA": {
        "index": 3,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0x9C007762CBf1ABF0Bb3e1C67660023bD3Ad1734D"
      },
      "QQQ": {
        "index": 4,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0x951D61C56CC4c3b79CF7078C371C474917480FDd"
      },
      "SPY": {
        "index": 5,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0x334D4fbf590Cbc3553fBdd6f11a2C0d7C1221e8A"
      },
      "EWY": {
        "index": 6,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0x35D2Cd90b6Ba62ea33F38A711DbB99C6C3D81Ba7"
      },
      "NVDA": {
        "index": 7,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0xcA2bc103CD18EC0b7646969dcB383D64037cb5bB"
      },
      "COIN": {
        "index": 8,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0x48E93EbC08ccaa3D3fC9E388bfEfD8209922D1cb"
      },
      "SPCX": {
        "index": 9,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0x0EAe421365011aE66dfa8bb9D1E8Baee54e5402d"
      },
      "MU": {
        "index": 10,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0x1868dB80a42E6D303E3A961886ba4534b6f56d40"
      },
      "SKHY": {
        "index": 11,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0x0a750ABB292C902D9752C5f508Ec6f5ec9Be7FCd"
      },
      "SNDK": {
        "index": 12,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0x5dBd79079fc1abA28F0a270beEcD855aCda98c88"
      },
      "DRAM": {
        "index": 13,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0xC3827d938c96232b3a08E83D71D084965Eb7e3Fb"
      },
      "META": {
        "index": 14,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0x778d648c02c8F521bE22f903Fd2edb8bD6F34DFB"
      },
      "GOOGL": {
        "index": 15,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0x84d0040153e67618D49C49EDb3f50e6Ed8de0d7D"
      },
      "AAPL": {
        "index": 16,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0xCa103C4D4bb8CEf8bf3A8622b0a3fCA58d835118"
      },
      "CRCL": {
        "index": 17,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0x4A87676cbF3d0e725aeF3DaF8962Ea805Dda569e"
      },
      "AMZN": {
        "index": 18,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0x53a0B4cB036BeCE074194171B3A6f885276d61C3"
      },
      "MSFT": {
        "index": 19,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0x9AA5a975b26432730173AEeAa20E9DD1C999Ee99"
      },
      "PLTR": {
        "index": 20,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0x3DbD73E6BE453E79D28968503bb88c6c5f7d12BA"
      }
    }
  },
  "giwa": {
    "name": "GIWA Sepolia",
    "chainId": 91342,
    "testnet": true,
    "siteUrl": "https://app.callput.app/?chain=giwa",
    "explorerUrl": "https://sepolia-explorer.giwa.io",
    "rpcUrl": "https://sepolia-rpc.giwa.io",
    "marketDataUrl": "https://app-data-giwa.s3.ap-southeast-1.amazonaws.com/market-data.json",
    "contracts": {
      "POSITION_MANAGER": "0x8cB54E8df9146220a09cAa9a69fc4B303dD66E69",
      "SETTLE_MANAGER": "0x04bE0bb52BEb45476AD08b3816bd264e4c1A089C",
      "USDC": "0x79AD98fA252D64A9095f83cc6FaF4243E0d01d48",
      "WBTC": "0x7eBbdF7ffCaB33e244D465E7FA08756Fd7F7738b",
      "WETH": "0x887Af039C15CCe9636195C80254B46a8Faf03FDc",
      "ROUTER": "0x95D1013be04e2D7da6C7E6e96fbC4dAE16Ee23F2"
    },
    "underlyings": {
      "BTC": {
        "index": 1,
        "decimals": 8,
        "marketType": "CRYPTO",
        "optionsToken": "0x41C7ac8499B816f3855Ae50A8f83B9cCC4a5ef1C"
      },
      "ETH": {
        "index": 2,
        "decimals": 18,
        "marketType": "CRYPTO",
        "optionsToken": "0xeB23B7D203fD855460D553D399FFDE097D212330"
      },
      "TSLA": {
        "index": 3,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0x3e76b638B6a155Ed11f6786EB1c5D4F76c73ee33"
      },
      "QQQ": {
        "index": 4,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0x2Ee3D8975294f708305d3b89badF21cd6C30ae15"
      },
      "SPY": {
        "index": 5,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0xEd4E831748478c792a9A999795D5C760722B4E4B"
      },
      "EWY": {
        "index": 6,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0x23024a86556898631854fF4bB9eB150b3B6D021B"
      },
      "NVDA": {
        "index": 7,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0xf450e2123089A71AC900d1eBb3021d9bAd207989"
      },
      "COIN": {
        "index": 8,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0x2FB3db24D0896180976074f5261DFBeBfB274bC3"
      },
      "SPCX": {
        "index": 9,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0x177C0b73884b55943A7f34f40414A83bfccb3a07"
      },
      "MU": {
        "index": 10,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0x3884B05F004833cfF557f92940ec980499f2BD89"
      },
      "SKHY": {
        "index": 11,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0x5CA572Ebd1473858d4Fb91e52573450022a625d2"
      },
      "SNDK": {
        "index": 12,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0xA7F820af600221871Be838533696925020d25B73"
      },
      "DRAM": {
        "index": 13,
        "decimals": 18,
        "marketType": "STOCK",
        "optionsToken": "0x1b5a053107C520E09248D8b24e169a4613892957"
      }
    }
  }
} as const;
