// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @notice TEST ONLY. Stand-in for tUSD8: 6 decimals, EIP-2612 permit, open minting.
///         Never deploy this to Aevum; the real tUSD8 is already deployed by QDay.
contract MockUSD8 is ERC20, ERC20Permit {
    constructor() ERC20("Mock tUSD8", "tUSD8") ERC20Permit("Mock tUSD8") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
