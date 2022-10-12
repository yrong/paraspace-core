import hre from "hardhat";
import {expect} from "chai";
import {BigNumber, utils} from "ethers";
import {MAX_UINT_AMOUNT, oneEther} from "../deploy/helpers/constants";
import {convertToCurrencyDecimals} from "../deploy/helpers/contracts-helpers";
import {increaseTime, waitForTx} from "../deploy/helpers/misc-utils";
import {ProtocolErrors, RateMode} from "../deploy/helpers/types";
import {makeSuite} from "./helpers/make-suite";
import {calcExpectedVariableDebtTokenBalance} from "./helpers/utils/calculations";
import {getReserveData, getUserData} from "./helpers/utils/helpers";

makeSuite(
  "Pool Liquidation: Liquidator receiving the underlying asset",
  (testEnv) => {
    const {INVALID_HF} = ProtocolErrors;

    before(async () => {
      const {addressesProvider, oracle} = testEnv;

      await waitForTx(await addressesProvider.setPriceOracle(oracle.address));
    });

    after(async () => {
      const {paraspaceOracle, addressesProvider} = testEnv;
      await waitForTx(
        await addressesProvider.setPriceOracle(paraspaceOracle.address)
      );
    });

    it("It's not possible to liquidate on a non-active collateral or a non active principal", async () => {
      const {
        configurator,
        weth,
        pool,
        users: [, user],
        dai,
      } = testEnv;
      await configurator.setReserveActive(weth.address, false);

      await expect(
        pool.liquidationCall(
          weth.address,
          dai.address,
          user.address,
          utils.parseEther("1000"),
          false
        )
      ).to.be.revertedWith("2");

      await configurator.setReserveActive(weth.address, true);

      await configurator.setReserveActive(dai.address, false);

      await expect(
        pool.liquidationCall(
          weth.address,
          dai.address,
          user.address,
          utils.parseEther("1000"),
          false
        )
      ).to.be.revertedWith("2");

      await configurator.setReserveActive(dai.address, true);
    });

    it("Deposits WETH, borrows DAI", async () => {
      const {
        dai,
        weth,
        users: [depositor, borrower],
        pool,
        oracle,
      } = testEnv;

      //mints DAI to depositor
      await dai
        .connect(depositor.signer)
        ["mint(uint256)"](await convertToCurrencyDecimals(dai.address, "1000"));

      //approve protocol to access depositor wallet
      await dai
        .connect(depositor.signer)
        .approve(pool.address, MAX_UINT_AMOUNT);

      //user 1 deposits 1000 DAI
      const amountDAItoDeposit = await convertToCurrencyDecimals(
        dai.address,
        "1000"
      );

      await pool
        .connect(depositor.signer)
        .supply(dai.address, amountDAItoDeposit, depositor.address, "0");
      //user 2 deposits  ETH
      const amountETHtoDeposit = await convertToCurrencyDecimals(
        weth.address,
        "0.06775"
      );

      //mints WETH to borrower
      await weth
        .connect(borrower.signer)
        ["mint(uint256)"](
          await convertToCurrencyDecimals(weth.address, "1000")
        );

      //approve protocol to access the borrower wallet
      await weth
        .connect(borrower.signer)
        .approve(pool.address, MAX_UINT_AMOUNT);

      await pool
        .connect(borrower.signer)
        .supply(weth.address, amountETHtoDeposit, borrower.address, "0");

      //user 2 borrows

      const userGlobalData = await pool.getUserAccountData(borrower.address);
      const daiPrice = await oracle.getAssetPrice(dai.address);

      const amountDAIToBorrow = await convertToCurrencyDecimals(
        dai.address,
        userGlobalData.availableBorrowsBase
          .div(daiPrice)
          .percentMul(9500)
          .toString()
      );

      await pool
        .connect(borrower.signer)
        .borrow(
          dai.address,
          amountDAIToBorrow,
          RateMode.Variable,
          "0",
          borrower.address
        );

      const userGlobalDataAfter = await pool.getUserAccountData(
        borrower.address
      );

      expect(userGlobalDataAfter.currentLiquidationThreshold).to.be.equal(
        8500,
        INVALID_HF
      );
    });

    it("Drop the health factor below 1", async () => {
      const {
        dai,
        users: [, borrower],
        pool,
        oracle,
      } = testEnv;

      const daiPrice = await oracle.getAssetPrice(dai.address);

      await oracle.setAssetPrice(dai.address, daiPrice.percentMul(11800));

      const userGlobalData = await pool.getUserAccountData(borrower.address);

      expect(userGlobalData.healthFactor).to.be.lt(oneEther, INVALID_HF);
    });

    it("Liquidates the borrow", async () => {
      const {
        dai,
        weth,
        users: [, borrower, , liquidator],
        pool,
        oracle,
        helpersContract,
      } = testEnv;

      //mints dai to the liquidator
      await dai
        .connect(liquidator.signer)
        ["mint(uint256)"](await convertToCurrencyDecimals(dai.address, "1000"));

      //approve protocol to access the liquidator wallet
      await dai
        .connect(liquidator.signer)
        .approve(pool.address, MAX_UINT_AMOUNT);

      const daiReserveDataBefore = await getReserveData(
        helpersContract,
        dai.address
      );
      const ethReserveDataBefore = await getReserveData(
        helpersContract,
        weth.address
      );

      const userReserveDataBefore = await getUserData(
        pool,
        helpersContract,
        dai.address,
        borrower.address
      );

      const amountToLiquidate =
        userReserveDataBefore.currentVariableDebt.div(2);

      await increaseTime(100);

      const tx = await pool
        .connect(liquidator.signer)
        .liquidationCall(
          weth.address,
          dai.address,
          borrower.address,
          amountToLiquidate,
          false
        );

      const userReserveDataAfter = await getUserData(
        pool,
        helpersContract,
        dai.address,
        borrower.address
      );

      const daiReserveDataAfter = await getReserveData(
        helpersContract,
        dai.address
      );
      const ethReserveDataAfter = await getReserveData(
        helpersContract,
        weth.address
      );

      const collateralPrice = await oracle.getAssetPrice(weth.address);
      const principalPrice = await oracle.getAssetPrice(dai.address);

      const collateralDecimals = (
        await helpersContract.getReserveConfigurationData(weth.address)
      ).decimals;
      const principalDecimals = (
        await helpersContract.getReserveConfigurationData(dai.address)
      ).decimals;

      const expectedCollateralLiquidated = principalPrice
        .mul(amountToLiquidate)
        .percentMul(10500)
        .mul(BigNumber.from(10).pow(collateralDecimals))
        .div(collateralPrice.mul(BigNumber.from(10).pow(principalDecimals)));

      if (!tx.blockNumber) {
        expect(false, "Invalid block number");
        return;
      }
      const txTimestamp = BigNumber.from(
        (await hre.ethers.provider.getBlock(tx.blockNumber)).timestamp
      );

      const variableDebtBeforeTx = calcExpectedVariableDebtTokenBalance(
        daiReserveDataBefore,
        userReserveDataBefore,
        txTimestamp
      );

      expect(userReserveDataAfter.currentVariableDebt).to.be.closeTo(
        variableDebtBeforeTx.sub(amountToLiquidate),
        2,
        "Invalid user debt after liquidation"
      );

      //the liquidity index of the principal reserve needs to be bigger than the index before
      expect(daiReserveDataAfter.liquidityIndex).to.be.gte(
        daiReserveDataBefore.liquidityIndex,
        "Invalid liquidity index"
      );

      //the principal APY after a liquidation needs to be lower than the APY before
      expect(daiReserveDataAfter.liquidityRate).to.be.lt(
        daiReserveDataBefore.liquidityRate,
        "Invalid liquidity APY"
      );

      expect(daiReserveDataAfter.totalLiquidity).to.be.closeTo(
        daiReserveDataBefore.totalLiquidity.add(amountToLiquidate),
        2,
        "Invalid principal total liquidity"
      );

      expect(ethReserveDataAfter.totalLiquidity).to.be.closeTo(
        ethReserveDataBefore.totalLiquidity.sub(expectedCollateralLiquidated),
        2,
        "Invalid collateral total liquidity"
      );

      expect(daiReserveDataAfter.availableLiquidity).to.be.closeTo(
        daiReserveDataBefore.availableLiquidity.add(amountToLiquidate),
        2,
        "Invalid principal available liquidity"
      );

      expect(ethReserveDataAfter.availableLiquidity).to.be.closeTo(
        ethReserveDataBefore.availableLiquidity.sub(
          expectedCollateralLiquidated
        ),
        2,
        "Invalid collateral available liquidity"
      );
    });

    it("User 3 deposits 1000 USDC, user 4 0.06775 WETH, user 4 borrows - drops HF, liquidates the borrow", async () => {
      const {
        usdc,
        users: [, , , depositor, borrower, liquidator],
        pool,
        oracle,
        weth,
        helpersContract,
      } = testEnv;

      //mints USDC to depositor
      await usdc
        .connect(depositor.signer)
        ["mint(uint256)"](
          await convertToCurrencyDecimals(usdc.address, "1000")
        );

      //approve protocol to access depositor wallet
      await usdc
        .connect(depositor.signer)
        .approve(pool.address, MAX_UINT_AMOUNT);

      //depositor deposits 1000 USDC
      const amountUSDCtoDeposit = await convertToCurrencyDecimals(
        usdc.address,
        "1000"
      );

      await pool
        .connect(depositor.signer)
        .supply(usdc.address, amountUSDCtoDeposit, depositor.address, "0");

      //borrower deposits ETH
      const amountETHtoDeposit = await convertToCurrencyDecimals(
        weth.address,
        "0.06775"
      );

      //mints WETH to borrower
      await weth
        .connect(borrower.signer)
        ["mint(uint256)"](
          await convertToCurrencyDecimals(weth.address, "1000")
        );

      //approve protocol to access the borrower wallet
      await weth
        .connect(borrower.signer)
        .approve(pool.address, MAX_UINT_AMOUNT);

      await pool
        .connect(borrower.signer)
        .supply(weth.address, amountETHtoDeposit, borrower.address, "0");

      //borrower borrows
      const userGlobalData = await pool.getUserAccountData(borrower.address);

      const usdcPrice = await oracle.getAssetPrice(usdc.address);

      const amountUSDCToBorrow = await convertToCurrencyDecimals(
        usdc.address,
        userGlobalData.availableBorrowsBase
          .div(usdcPrice)
          .percentMul(9502)
          .toString()
      );

      await pool
        .connect(borrower.signer)
        .borrow(
          usdc.address,
          amountUSDCToBorrow,
          RateMode.Variable,
          "0",
          borrower.address
        );

      //drops HF below 1
      await oracle.setAssetPrice(usdc.address, usdcPrice.percentMul(11200));

      //mints dai to the liquidator

      await usdc
        .connect(liquidator.signer)
        ["mint(uint256)"](
          await convertToCurrencyDecimals(usdc.address, "1000")
        );

      //approve protocol to access depositor wallet
      await usdc
        .connect(liquidator.signer)
        .approve(pool.address, MAX_UINT_AMOUNT);

      const userReserveDataBefore = await helpersContract.getUserReserveData(
        usdc.address,
        borrower.address
      );

      const usdcReserveDataBefore = await getReserveData(
        helpersContract,
        usdc.address
      );
      const ethReserveDataBefore = await getReserveData(
        helpersContract,
        weth.address
      );

      const amountToLiquidate =
        userReserveDataBefore.currentVariableDebt.div(2);

      await pool
        .connect(liquidator.signer)
        .liquidationCall(
          weth.address,
          usdc.address,
          borrower.address,
          amountToLiquidate,
          false
        );

      const userReserveDataAfter = await helpersContract.getUserReserveData(
        usdc.address,
        borrower.address
      );

      const userGlobalDataAfter = await pool.getUserAccountData(
        borrower.address
      );

      const usdcReserveDataAfter = await getReserveData(
        helpersContract,
        usdc.address
      );
      const ethReserveDataAfter = await getReserveData(
        helpersContract,
        weth.address
      );

      const collateralPrice = await oracle.getAssetPrice(weth.address);
      const principalPrice = await oracle.getAssetPrice(usdc.address);

      const collateralDecimals = (
        await helpersContract.getReserveConfigurationData(weth.address)
      ).decimals;
      const principalDecimals = (
        await helpersContract.getReserveConfigurationData(usdc.address)
      ).decimals;

      const expectedCollateralLiquidated = principalPrice
        .mul(BigNumber.from(amountToLiquidate))
        .percentMul(10500)
        .mul(BigNumber.from(10).pow(collateralDecimals))
        .div(collateralPrice.mul(BigNumber.from(10).pow(principalDecimals)));

      expect(userGlobalDataAfter.healthFactor).to.be.gt(
        oneEther,
        "Invalid health factor"
      );

      expect(userReserveDataAfter.currentVariableDebt).to.be.closeTo(
        userReserveDataBefore.currentVariableDebt.sub(amountToLiquidate),
        2,
        "Invalid user borrow balance after liquidation"
      );

      //the liquidity index of the principal reserve needs to be bigger than the index before
      expect(usdcReserveDataAfter.liquidityIndex).to.be.gte(
        usdcReserveDataBefore.liquidityIndex,
        "Invalid liquidity index"
      );

      //the principal APY after a liquidation needs to be lower than the APY before
      expect(usdcReserveDataAfter.liquidityRate).to.be.lt(
        usdcReserveDataBefore.liquidityRate,
        "Invalid liquidity APY"
      );

      expect(usdcReserveDataAfter.totalLiquidity).to.be.closeTo(
        usdcReserveDataBefore.totalLiquidity.add(amountToLiquidate),
        2,
        "Invalid principal total liquidity"
      );

      expect(ethReserveDataAfter.totalLiquidity).to.be.closeTo(
        ethReserveDataBefore.totalLiquidity.sub(expectedCollateralLiquidated),
        2,
        "Invalid collateral total liquidity"
      );

      expect(usdcReserveDataAfter.availableLiquidity).to.be.closeTo(
        usdcReserveDataBefore.availableLiquidity.add(amountToLiquidate),
        2,
        "Invalid principal available liquidity"
      );

      expect(ethReserveDataAfter.availableLiquidity).to.be.closeTo(
        ethReserveDataBefore.availableLiquidity.sub(
          expectedCollateralLiquidated
        ),
        2,
        "Invalid collateral available liquidity"
      );
    });

    //   it("User 4 deposits 0.033 ParaSpace - drops HF, liquidates the ParaSpace, which results on a lower amount being liquidated", async () => {
    //     const {
    //       paraspace,
    //       usdc,
    //       users: [, , , , borrower, liquidator],
    //       pool,
    //       oracle,
    //       helpersContract,
    //     } = testEnv;

    //     //mints ParaSpace to borrower
    //     await paraspace
    //       .connect(borrower.signer)
    //       ["mint(uint256)"](
    //         await convertToCurrencyDecimals(paraspace.address, "0.033")
    //       );

    //     //approve protocol to access the borrower wallet
    //     await paraspace
    //       .connect(borrower.signer)
    //       .approve(pool.address, MAX_UINT_AMOUNT);

    //     //borrower deposits 1 ParaSpace
    //     const amountToDeposit = await convertToCurrencyDecimals(
    //       paraspace.address,
    //       "0.033"
    //     );

    //     await pool
    //       .connect(borrower.signer)
    //       .supply(paraspace.address, amountToDeposit, borrower.address, "0");
    //     const usdcPrice = await oracle.getAssetPrice(usdc.address);

    //     //drops HF below 1
    //     await oracle.setAssetPrice(usdc.address, usdcPrice.percentMul(11400));

    //     //mints usdc to the liquidator
    //     await usdc
    //       .connect(liquidator.signer)
    //       ["mint(uint256)"](
    //         await convertToCurrencyDecimals(usdc.address, "1000")
    //       );

    //     //approve protocol to access liquidator wallet
    //     await usdc
    //       .connect(liquidator.signer)
    //       .approve(pool.address, MAX_UINT_AMOUNT);

    //     const userReserveDataBefore = await helpersContract.getUserReserveData(
    //       usdc.address,
    //       borrower.address
    //     );

    //     const usdcReserveDataBefore = await getReserveData(
    //       helpersContract,
    //       usdc.address
    //     );
    //     const paraspaceReserveDataBefore = await getReserveData(
    //       helpersContract,
    //       paraspace.address
    //     );

    //     const amountToLiquidate = userReserveDataBefore.currentStableDebt.div(2);

    //     const collateralPrice = await oracle.getAssetPrice(paraspace.address);
    //     const principalPrice = await oracle.getAssetPrice(usdc.address);

    //     await pool
    //       .connect(liquidator.signer)
    //       .liquidationCall(
    //         paraspace.address,
    //         usdc.address,
    //         borrower.address,
    //         amountToLiquidate,
    //         false
    //       );

    //     const userReserveDataAfter = await helpersContract.getUserReserveData(
    //       usdc.address,
    //       borrower.address
    //     );

    //     const userGlobalDataAfter = await pool.getUserAccountData(
    //       borrower.address
    //     );

    //     const usdcReserveDataAfter = await getReserveData(
    //       helpersContract,
    //       usdc.address
    //     );
    //     const paraspaceReserveDataAfter = await getReserveData(
    //       helpersContract,
    //       paraspace.address
    //     );

    //     const paraspaceConfiguration =
    //       await helpersContract.getReserveConfigurationData(paraspace.address);
    //     const collateralDecimals = paraspaceConfiguration.decimals;
    //     const liquidationBonus = paraspaceConfiguration.liquidationBonus;

    //     const principalDecimals = (
    //       await helpersContract.getReserveConfigurationData(usdc.address)
    //     ).decimals;

    //     const expectedCollateralLiquidated = oneEther.mul("33").div("1000");

    //     const expectedPrincipal = collateralPrice
    //       .mul(expectedCollateralLiquidated)
    //       .mul(BigNumber.from(10).pow(principalDecimals))
    //       .div(principalPrice.mul(BigNumber.from(10).pow(collateralDecimals)))
    //       .percentDiv(liquidationBonus);

    //     expect(userGlobalDataAfter.healthFactor).to.be.gt(
    //       oneEther,
    //       "Invalid health factor"
    //     );

    //     expect(userReserveDataAfter.currentStableDebt).to.be.closeTo(
    //       userReserveDataBefore.currentStableDebt.sub(expectedPrincipal),
    //       2,
    //       "Invalid user borrow balance after liquidation"
    //     );

    //     expect(usdcReserveDataAfter.totalLiquidity).to.be.closeTo(
    //       usdcReserveDataBefore.totalLiquidity.add(expectedPrincipal),
    //       2,
    //       "Invalid principal total liquidity"
    //     );

    //     expect(paraspaceReserveDataAfter.totalLiquidity).to.be.closeTo(
    //       paraspaceReserveDataBefore.totalLiquidity.sub(expectedCollateralLiquidated),
    //       2,
    //       "Invalid collateral total liquidity"
    //     );

    //     expect(usdcReserveDataAfter.availableLiquidity).to.be.closeTo(
    //       usdcReserveDataBefore.availableLiquidity.add(expectedPrincipal),
    //       2,
    //       "Invalid principal available liquidity"
    //     );

    //     expect(paraspaceReserveDataAfter.availableLiquidity).to.be.closeTo(
    //       paraspaceReserveDataBefore.availableLiquidity.sub(
    //         expectedCollateralLiquidated
    //       ),
    //       2,
    //       "Invalid collateral available liquidity"
    //     );
    //   });
  }
);
