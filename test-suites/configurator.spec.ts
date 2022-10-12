import {expect} from "chai";
import {BigNumber, BigNumberish} from "ethers";
import {parseEther} from "ethers/lib/utils";
import {
  MAX_UINT_AMOUNT,
  ONE_ADDRESS,
  RAY,
  ZERO_ADDRESS,
} from "../deploy/helpers/constants";
import {deployDefaultReserveAuctionStrategy} from "../deploy/helpers/contracts-deployments";
import {getFirstSigner} from "../deploy/helpers/contracts-getters";
import {evmRevert, evmSnapshot} from "../deploy/helpers/misc-utils";
import {ProtocolErrors} from "../deploy/helpers/types";
import {auctionStrategyExp} from "../deploy/market-config/auctionStrategies";
import {strategyWETH} from "../deploy/market-config/reservesConfigs";
import {
  MintableERC20__factory,
  MockReserveInterestRateStrategy__factory,
  ProtocolDataProvider,
  PToken__factory,
  StableDebtToken__factory,
  VariableDebtToken__factory,
} from "../types";
// import {strategyWETH} from "../market-config/reservesConfigs";
import {TestEnv, makeSuite} from "./helpers/make-suite";

type ReserveConfigurationValues = {
  reserveDecimals: string;
  baseLTVAsCollateral: string;
  liquidationThreshold: string;
  liquidationBonus: string;
  reserveFactor: string;
  usageAsCollateralEnabled: boolean;
  borrowingEnabled: boolean;
  stableBorrowRateEnabled: boolean;
  isActive: boolean;
  isFrozen: boolean;
  isPaused: boolean;
  // eModeCategory: BigNumber;
  borrowCap: string;
  supplyCap: string;
  liquidationProtocolFee: BigNumber;
};

const expectReserveConfigurationData = async (
  helpersContract: ProtocolDataProvider,
  asset: string,
  values: ReserveConfigurationValues
) => {
  const [reserveCfg, reserveCaps, isPaused, liquidationProtocolFee] =
    await getReserveData(helpersContract, asset);
  expect(reserveCfg.decimals).to.be.eq(
    values.reserveDecimals,
    "reserveDecimals is not correct"
  );
  expect(reserveCfg.ltv).to.be.eq(
    values.baseLTVAsCollateral,
    "ltv is not correct"
  );
  expect(reserveCfg.liquidationThreshold).to.be.eq(
    values.liquidationThreshold,
    "liquidationThreshold is not correct"
  );
  expect(reserveCfg.liquidationBonus).to.be.eq(
    values.liquidationBonus,
    "liquidationBonus is not correct"
  );
  expect(reserveCfg.reserveFactor).to.be.eq(
    values.reserveFactor,
    "reserveFactor is not correct"
  );
  expect(reserveCfg.usageAsCollateralEnabled).to.be.eq(
    values.usageAsCollateralEnabled,
    "usageAsCollateralEnabled is not correct"
  );
  expect(reserveCfg.borrowingEnabled).to.be.eq(
    values.borrowingEnabled,
    "borrowingEnabled is not correct"
  );
  expect(reserveCfg.stableBorrowRateEnabled).to.be.eq(
    values.stableBorrowRateEnabled,
    "stableBorrowRateEnabled is not correct"
  );
  expect(reserveCfg.isActive).to.be.eq(
    values.isActive,
    "isActive is not correct"
  );
  expect(reserveCfg.isFrozen).to.be.eq(
    values.isFrozen,
    "isFrozen is not correct"
  );
  expect(isPaused).to.be.equal(values.isPaused, "isPaused is not correct");
  // expect(eModeCategory).to.be.eq(
  //   values.eModeCategory,
  //   "eModeCategory is not correct"
  // );
  expect(reserveCaps.borrowCap).to.be.eq(
    values.borrowCap,
    "borrowCap is not correct"
  );
  expect(reserveCaps.supplyCap).to.be.eq(
    values.supplyCap,
    "supplyCap is not correct"
  );
  expect(liquidationProtocolFee).to.be.eq(
    values.liquidationProtocolFee,
    "liquidationProtocolFee is not correct"
  );
};

const getReserveData = async (
  helpersContract: ProtocolDataProvider,
  asset: string
) => {
  return Promise.all([
    helpersContract.getReserveConfigurationData(asset),
    // helpersContract.getReserveEModeCategory(asset),
    helpersContract.getReserveCaps(asset),
    helpersContract.getPaused(asset),
    helpersContract.getLiquidationProtocolFee(asset),
    // helpersContract.getUnbackedMintCap(asset),
  ]);
};

makeSuite("PoolConfigurator", (testEnv: TestEnv) => {
  let baseConfigValues: ReserveConfigurationValues;

  before(() => {
    const {
      reserveDecimals,
      baseLTVAsCollateral,
      liquidationThreshold,
      liquidationBonus,
      reserveFactor,
      borrowingEnabled,
      stableBorrowRateEnabled,
      borrowCap,
      supplyCap,
    } = strategyWETH;
    baseConfigValues = {
      reserveDecimals,
      baseLTVAsCollateral,
      liquidationThreshold,
      liquidationBonus,
      reserveFactor,
      usageAsCollateralEnabled: true,
      borrowingEnabled,
      stableBorrowRateEnabled,
      isActive: true,
      isFrozen: false,
      isPaused: false,
      // eModeCategory: BigNumber.from(0),
      borrowCap: borrowCap,
      supplyCap: supplyCap,
      liquidationProtocolFee: BigNumber.from(0),
    };
  });

  it("InitReserves via AssetListing admin", async () => {
    const {
      addressesProvider,
      configurator,
      poolAdmin,
      aclManager,
      pool,
      assetListingAdmin,
    } = testEnv;

    // Add new AssetListingAdmin
    expect(
      await aclManager
        .connect(poolAdmin.signer)
        .addAssetListingAdmin(assetListingAdmin.address)
    );

    // Deploy mock `InitReserveInput`
    const mockToken = await new MintableERC20__factory(
      await getFirstSigner()
    ).deploy("MOCK", "MOCK", "18");
    const stableDebtTokenImplementation = await new StableDebtToken__factory(
      await getFirstSigner()
    ).deploy(pool.address);
    const variableDebtTokenImplementation =
      await new VariableDebtToken__factory(await getFirstSigner()).deploy(
        pool.address
      );
    const xTokenImplementation = await new PToken__factory(
      await getFirstSigner()
    ).deploy(pool.address);
    const mockRateStrategy = await new MockReserveInterestRateStrategy__factory(
      await getFirstSigner()
    ).deploy(addressesProvider.address, 0, 0, 0, 0, 0, 0);
    const mockAuctionStrategy = await await deployDefaultReserveAuctionStrategy(
      [
        auctionStrategyExp.maxPriceMultiplier,
        auctionStrategyExp.minExpPriceMultiplier,
        auctionStrategyExp.minPriceMultiplier,
        auctionStrategyExp.stepLinear,
        auctionStrategyExp.stepExp,
        auctionStrategyExp.tickLength,
      ]
    );
    // Init the reserve
    const initInputParams: {
      xTokenImpl: string;
      stableDebtTokenImpl: string;
      variableDebtTokenImpl: string;
      assetType: BigNumberish;
      underlyingAssetDecimals: BigNumberish;
      interestRateStrategyAddress: string;
      auctionStrategyAddress: string;
      underlyingAsset: string;
      treasury: string;
      incentivesController: string;
      xTokenName: string;
      xTokenSymbol: string;
      variableDebtTokenName: string;
      variableDebtTokenSymbol: string;
      stableDebtTokenName: string;
      stableDebtTokenSymbol: string;
      params: string;
    }[] = [
      {
        xTokenImpl: xTokenImplementation.address,
        stableDebtTokenImpl: stableDebtTokenImplementation.address,
        variableDebtTokenImpl: variableDebtTokenImplementation.address,
        assetType: 0,
        underlyingAssetDecimals: 18,
        interestRateStrategyAddress: mockRateStrategy.address,
        auctionStrategyAddress: mockAuctionStrategy.address,
        underlyingAsset: mockToken.address,
        treasury: ZERO_ADDRESS,
        incentivesController: ZERO_ADDRESS,
        xTokenName: "PMOCK",
        xTokenSymbol: "PMOCK",
        variableDebtTokenName: "VMOCK",
        variableDebtTokenSymbol: "VMOCK",
        stableDebtTokenName: "SMOCK",
        stableDebtTokenSymbol: "SMOCK",
        params: "0x10",
      },
    ];

    expect(
      await configurator
        .connect(assetListingAdmin.signer)
        .initReserves(initInputParams)
    );
  });

  it("Deactivates the ETH reserve", async () => {
    const {configurator, weth, helpersContract} = testEnv;
    expect(await configurator.setReserveActive(weth.address, false));
    const {isActive} = await helpersContract.getReserveConfigurationData(
      weth.address
    );
    expect(isActive).to.be.equal(false);
  });

  it("Reactivates the ETH reserve", async () => {
    const {configurator, weth, helpersContract} = testEnv;
    expect(await configurator.setReserveActive(weth.address, true));
    const {isActive} = await helpersContract.getReserveConfigurationData(
      weth.address
    );
    expect(isActive).to.be.equal(true);
  });

  it("Pauses the ETH reserve by pool admin", async () => {
    const {configurator, weth, helpersContract} = testEnv;
    expect(await configurator.setReservePause(weth.address, true))
      .to.emit(configurator, "ReservePaused")
      .withArgs(weth.address, true);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
      isPaused: true,
    });
  });

  it("Unpauses the ETH reserve by pool admin", async () => {
    const {configurator, helpersContract, weth} = testEnv;
    expect(await configurator.setReservePause(weth.address, false))
      .to.emit(configurator, "ReservePaused")
      .withArgs(weth.address, false);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
    });
  });

  it("Pauses the ETH reserve by emergency admin", async () => {
    const {configurator, weth, helpersContract, emergencyAdmin} = testEnv;
    expect(
      await configurator
        .connect(emergencyAdmin.signer)
        .setReservePause(weth.address, true)
    )
      .to.emit(configurator, "ReservePaused")
      .withArgs(weth.address, true);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
      isPaused: true,
    });
  });

  it("Unpauses the ETH reserve by emergency admin", async () => {
    const {configurator, helpersContract, weth, emergencyAdmin} = testEnv;
    expect(
      await configurator
        .connect(emergencyAdmin.signer)
        .setReservePause(weth.address, false)
    )
      .to.emit(configurator, "ReservePaused")
      .withArgs(weth.address, false);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
    });
  });

  it("Freezes the ETH reserve by pool Admin", async () => {
    const {configurator, weth, helpersContract} = testEnv;

    expect(await configurator.setReserveFreeze(weth.address, true))
      .to.emit(configurator, "ReserveFrozen")
      .withArgs(weth.address, true);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
      isFrozen: true,
    });
  });

  it("Unfreezes the ETH reserve by Pool admin", async () => {
    const {configurator, helpersContract, weth} = testEnv;
    expect(await configurator.setReserveFreeze(weth.address, false))
      .to.emit(configurator, "ReserveFrozen")
      .withArgs(weth.address, false);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
    });
  });

  it("Freezes the ETH reserve by Risk Admin", async () => {
    const {configurator, weth, helpersContract, riskAdmin} = testEnv;
    expect(
      await configurator
        .connect(riskAdmin.signer)
        .setReserveFreeze(weth.address, true)
    )
      .to.emit(configurator, "ReserveFrozen")
      .withArgs(weth.address, true);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
      isFrozen: true,
    });
  });

  it("Unfreezes the ETH reserve by Risk admin", async () => {
    const {configurator, helpersContract, weth, riskAdmin} = testEnv;
    expect(
      await configurator
        .connect(riskAdmin.signer)
        .setReserveFreeze(weth.address, false)
    )
      .to.emit(configurator, "ReserveFrozen")
      .withArgs(weth.address, false);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
    });
  });

  it("Deactivates the ETH reserve for borrowing via pool admin while stable borrowing is active (revert expected)", async () => {
    const {configurator, helpersContract, weth} = testEnv;
    await configurator.setReserveStableRateBorrowing(weth.address, true);

    await expect(
      configurator.setReserveBorrowing(weth.address, false)
    ).to.be.revertedWith(ProtocolErrors.STABLE_BORROWING_ENABLED);

    await configurator.setReserveStableRateBorrowing(weth.address, false);
    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
    });
  });

  it("Deactivates the ETH reserve for borrowing via risk admin while stable borrowing is active (revert expected)", async () => {
    const {configurator, helpersContract, weth, riskAdmin} = testEnv;
    await configurator.setReserveStableRateBorrowing(weth.address, true);
    await expect(
      configurator
        .connect(riskAdmin.signer)
        .setReserveBorrowing(weth.address, false)
    ).to.be.revertedWith(ProtocolErrors.STABLE_BORROWING_ENABLED);

    await configurator.setReserveStableRateBorrowing(weth.address, false);
    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
    });
  });

  it("Disable stable borrow rate on the ETH reserve via pool admin", async () => {
    const {configurator, helpersContract, weth} = testEnv;
    await configurator.setReserveStableRateBorrowing(weth.address, true);
    expect(
      await configurator.setReserveStableRateBorrowing(weth.address, false)
    )
      .to.emit(configurator, "ReserveStableRateBorrowing")
      .withArgs(weth.address, false);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
      stableBorrowRateEnabled: false,
    });
  });

  it("Disable stable borrow rate on the ETH reserve via risk admin", async () => {
    const {configurator, helpersContract, weth, riskAdmin} = testEnv;
    expect(
      await configurator
        .connect(riskAdmin.signer)
        .setReserveStableRateBorrowing(weth.address, false)
    )
      .to.emit(configurator, "ReserveStableRateBorrowing")
      .withArgs(weth.address, false);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
      stableBorrowRateEnabled: false,
    });
  });

  it("Deactivates the ETH reserve for borrowing via pool admin", async () => {
    const snap = await evmSnapshot();
    const {configurator, helpersContract, weth} = testEnv;
    expect(await configurator.setReserveBorrowing(weth.address, false))
      .to.emit(configurator, "ReserveBorrowing")
      .withArgs(weth.address, false);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
      borrowingEnabled: false,
    });
    await evmRevert(snap);
  });

  it("Deactivates the ETH reserve for borrowing via risk admin", async () => {
    const {configurator, helpersContract, weth, riskAdmin} = testEnv;
    expect(
      await configurator
        .connect(riskAdmin.signer)
        .setReserveBorrowing(weth.address, false)
    )
      .to.emit(configurator, "ReserveBorrowing")
      .withArgs(weth.address, false);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
      borrowingEnabled: false,
    });
  });

  it("Enables stable borrow rate on the ETH reserve via pool admin while borrowing is disabled (revert expected)", async () => {
    const {configurator, helpersContract, weth} = testEnv;
    await expect(
      configurator.setReserveStableRateBorrowing(weth.address, true)
    ).to.be.revertedWith(ProtocolErrors.BORROWING_NOT_ENABLED);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
      borrowingEnabled: false,
    });
  });

  it("Enables stable borrow rate on the ETH reserve via risk admin while borrowing is disabled (revert expected)", async () => {
    const {configurator, helpersContract, weth, riskAdmin} = testEnv;
    await expect(
      configurator
        .connect(riskAdmin.signer)
        .setReserveStableRateBorrowing(weth.address, true)
    ).to.be.revertedWith(ProtocolErrors.BORROWING_NOT_ENABLED);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
      borrowingEnabled: false,
    });
  });

  it("Activates the ETH reserve for borrowing via pool admin", async () => {
    const snap = await evmSnapshot();
    const {configurator, weth, helpersContract} = testEnv;
    expect(await configurator.setReserveBorrowing(weth.address, true))
      .to.emit(configurator, "ReserveBorrowing")
      .withArgs(weth.address, true);

    const {variableBorrowIndex} = await helpersContract.getReserveData(
      weth.address
    );

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
    });
    expect(variableBorrowIndex.toString()).to.be.equal(RAY);
    await evmRevert(snap);
  });

  it("Activates the ETH reserve for borrowing via risk admin", async () => {
    const {configurator, weth, helpersContract, riskAdmin} = testEnv;
    expect(
      await configurator
        .connect(riskAdmin.signer)
        .setReserveBorrowing(weth.address, true)
    )
      .to.emit(configurator, "ReserveBorrowing")
      .withArgs(weth.address, true);

    const {variableBorrowIndex} = await helpersContract.getReserveData(
      weth.address
    );

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
    });
    expect(variableBorrowIndex.toString()).to.be.equal(RAY);
  });

  it("Enables stable borrow rate on the ETH reserve via pool admin", async () => {
    const snap = await evmSnapshot();
    const {configurator, helpersContract, weth} = testEnv;
    expect(await configurator.setReserveStableRateBorrowing(weth.address, true))
      .to.emit(configurator, "ReserveStableRateBorrowing")
      .withArgs(weth.address, true);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
      stableBorrowRateEnabled: true,
    });
    await evmRevert(snap);
  });

  it("Enables stable borrow rate on the ETH reserve via risk admin", async () => {
    const {configurator, helpersContract, weth, riskAdmin} = testEnv;
    const snap = await evmSnapshot();
    expect(
      await configurator
        .connect(riskAdmin.signer)
        .setReserveStableRateBorrowing(weth.address, true)
    )
      .to.emit(configurator, "ReserveStableRateBorrowing")
      .withArgs(weth.address, true);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
      stableBorrowRateEnabled: true,
    });
    await evmRevert(snap);
  });

  it("Deactivates the ETH reserve as collateral via pool admin", async () => {
    const {configurator, helpersContract, weth} = testEnv;
    expect(
      await configurator.configureReserveAsCollateral(weth.address, 0, 0, 0)
    )
      .to.emit(configurator, "CollateralConfigurationChanged")
      .withArgs(weth.address, 0, 0, 0);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
      baseLTVAsCollateral: "0",
      liquidationThreshold: "0",
      liquidationBonus: "0",
      usageAsCollateralEnabled: false,
    });
  });

  it("Activates the ETH reserve as collateral via pool admin", async () => {
    const {configurator, helpersContract, weth} = testEnv;
    expect(
      await configurator.configureReserveAsCollateral(
        weth.address,
        baseConfigValues.baseLTVAsCollateral,
        baseConfigValues.liquidationThreshold,
        baseConfigValues.liquidationBonus
      )
    )
      .to.emit(configurator, "CollateralConfigurationChanged")
      .withArgs(
        weth.address,
        baseConfigValues.baseLTVAsCollateral,
        baseConfigValues.liquidationThreshold,
        baseConfigValues.liquidationBonus
      );

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
      baseLTVAsCollateral: baseConfigValues.baseLTVAsCollateral,
      liquidationThreshold: baseConfigValues.liquidationThreshold,
      liquidationBonus: baseConfigValues.liquidationBonus,
    });
  });

  it("Deactivates the ETH reserve as collateral via risk admin", async () => {
    const {configurator, helpersContract, weth, riskAdmin} = testEnv;
    expect(
      await configurator
        .connect(riskAdmin.signer)
        .configureReserveAsCollateral(weth.address, 0, 0, 0)
    )
      .to.emit(configurator, "CollateralConfigurationChanged")
      .withArgs(weth.address, 0, 0, 0);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
      baseLTVAsCollateral: "0",
      liquidationThreshold: "0",
      liquidationBonus: "0",
      usageAsCollateralEnabled: false,
    });
  });

  it("Activates the ETH reserve as collateral via risk admin", async () => {
    const {configurator, helpersContract, weth, riskAdmin} = testEnv;
    expect(
      await configurator
        .connect(riskAdmin.signer)
        .configureReserveAsCollateral(
          weth.address,
          baseConfigValues.baseLTVAsCollateral,
          baseConfigValues.liquidationThreshold,
          baseConfigValues.liquidationBonus
        )
    )
      .to.emit(configurator, "CollateralConfigurationChanged")
      .withArgs(
        weth.address,
        baseConfigValues.baseLTVAsCollateral,
        baseConfigValues.liquidationThreshold,
        baseConfigValues.liquidationBonus
      );

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
      baseLTVAsCollateral: baseConfigValues.baseLTVAsCollateral,
      liquidationThreshold: baseConfigValues.liquidationThreshold,
      liquidationBonus: baseConfigValues.liquidationBonus,
    });
  });

  it("Changes the reserve factor of WETH via pool admin", async () => {
    const {configurator, helpersContract, weth} = testEnv;

    const {reserveFactor: oldReserveFactor} =
      await helpersContract.getReserveConfigurationData(weth.address);

    const newReserveFactor = "1000";
    expect(await configurator.setReserveFactor(weth.address, newReserveFactor))
      .to.emit(configurator, "ReserveFactorChanged")
      .withArgs(weth.address, oldReserveFactor, newReserveFactor);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
      reserveFactor: newReserveFactor,
    });
  });

  it("Changes the reserve factor of WETH via risk admin", async () => {
    const {configurator, helpersContract, weth, riskAdmin} = testEnv;

    const {reserveFactor: oldReserveFactor} =
      await helpersContract.getReserveConfigurationData(weth.address);

    const newReserveFactor = "1000";
    expect(
      await configurator
        .connect(riskAdmin.signer)
        .setReserveFactor(weth.address, newReserveFactor)
    )
      .to.emit(configurator, "ReserveFactorChanged")
      .withArgs(weth.address, oldReserveFactor, newReserveFactor);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
      reserveFactor: newReserveFactor,
    });
  });

  it("Updates the reserve factor of WETH equal to PERCENTAGE_FACTOR", async () => {
    const snapId = await evmSnapshot();
    const {configurator, helpersContract, weth, poolAdmin} = testEnv;

    const {reserveFactor: oldReserveFactor} =
      await helpersContract.getReserveConfigurationData(weth.address);

    const newReserveFactor = "10000";
    expect(
      await configurator
        .connect(poolAdmin.signer)
        .setReserveFactor(weth.address, newReserveFactor)
    )
      .to.emit(configurator, "ReserveFactorChanged")
      .withArgs(weth.address, oldReserveFactor, newReserveFactor);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
      reserveFactor: newReserveFactor,
    });
    await evmRevert(snapId);
  });

  // it("Updates the unbackedMintCap of WETH via pool admin", async () => {
  //   const { configurator, helpersContract, weth } = testEnv;

  //   const oldWethUnbackedMintCap = await helpersContract.getUnbackedMintCap(
  //     weth.address
  //   );

  //   const newUnbackedMintCap = "10000";
  //   expect(
  //     await configurator.setUnbackedMintCap(weth.address, newUnbackedMintCap)
  //   )
  //     .to.emit(configurator, "UnbackedMintCapChanged")
  //     .withArgs(weth.address, oldWethUnbackedMintCap, newUnbackedMintCap);

  //   expect(await helpersContract.getUnbackedMintCap(weth.address)).to.be.eq(
  //     newUnbackedMintCap
  //   );
  // });

  // it("Updates the unbackedMintCap of WETH via risk admin", async () => {
  //   const { configurator, helpersContract, weth } = testEnv;

  //   const oldWethUnbackedMintCap = await helpersContract.getUnbackedMintCap(
  //     weth.address
  //   );

  //   const newUnbackedMintCap = "20000";
  //   expect(
  //     await configurator.setUnbackedMintCap(weth.address, newUnbackedMintCap)
  //   )
  //     .to.emit(configurator, "UnbackedMintCapChanged")
  //     .withArgs(weth.address, oldWethUnbackedMintCap, newUnbackedMintCap);

  //   expect(await helpersContract.getUnbackedMintCap(weth.address)).to.be.eq(
  //     newUnbackedMintCap
  //   );
  // });

  it("Updates the borrowCap of WETH via pool admin", async () => {
    const {configurator, helpersContract, weth} = testEnv;

    const {borrowCap: wethOldBorrowCap} = await helpersContract.getReserveCaps(
      weth.address
    );

    const newBorrowCap = "3000000";
    expect(await configurator.setBorrowCap(weth.address, newBorrowCap))
      .to.emit(configurator, "BorrowCapChanged")
      .withArgs(weth.address, wethOldBorrowCap, newBorrowCap);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
      borrowCap: newBorrowCap,
    });
  });

  it("Updates the borrowCap of WETH risk admin", async () => {
    const {configurator, helpersContract, weth, riskAdmin} = testEnv;

    const {borrowCap: wethOldBorrowCap} = await helpersContract.getReserveCaps(
      weth.address
    );

    const newBorrowCap = "3000000";
    expect(
      await configurator
        .connect(riskAdmin.signer)
        .setBorrowCap(weth.address, newBorrowCap)
    )
      .to.emit(configurator, "BorrowCapChanged")
      .withArgs(weth.address, wethOldBorrowCap, newBorrowCap);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
      borrowCap: newBorrowCap,
    });
  });

  it("Updates the supplyCap of WETH via pool admin", async () => {
    const {configurator, helpersContract, weth} = testEnv;

    const {supplyCap: oldWethSupplyCap} = await helpersContract.getReserveCaps(
      weth.address
    );

    const newBorrowCap = "3000000";
    const newSupplyCap = "3000000";
    expect(await configurator.setSupplyCap(weth.address, newSupplyCap))
      .to.emit(configurator, "SupplyCapChanged")
      .withArgs(weth.address, oldWethSupplyCap, newSupplyCap);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
      borrowCap: newBorrowCap,
      supplyCap: newSupplyCap,
    });
  });

  it("Updates the supplyCap of WETH via risk admin", async () => {
    const {configurator, helpersContract, weth, riskAdmin} = testEnv;

    const {supplyCap: oldWethSupplyCap} = await helpersContract.getReserveCaps(
      weth.address
    );

    const newBorrowCap = "3000000";
    const newSupplyCap = "3000000";
    expect(
      await configurator
        .connect(riskAdmin.signer)
        .setSupplyCap(weth.address, newSupplyCap)
    )
      .to.emit(configurator, "SupplyCapChanged")
      .withArgs(weth.address, oldWethSupplyCap, newSupplyCap);

    await expectReserveConfigurationData(helpersContract, weth.address, {
      ...baseConfigValues,
      borrowCap: newBorrowCap,
      supplyCap: newSupplyCap,
    });
  });

  it("Updates the ReserveInterestRateStrategy address of WETH via pool admin", async () => {
    const {poolAdmin, pool, configurator, weth} = testEnv;

    const {interestRateStrategyAddress: interestRateStrategyAddressBefore} =
      await pool.getReserveData(weth.address);

    expect(
      await configurator
        .connect(poolAdmin.signer)
        .setReserveInterestRateStrategyAddress(weth.address, ZERO_ADDRESS)
    )
      .to.emit(configurator, "ReserveInterestRateStrategyChanged")
      .withArgs(weth.address, interestRateStrategyAddressBefore, ZERO_ADDRESS);
    const {interestRateStrategyAddress: interestRateStrategyAddressAfter} =
      await pool.getReserveData(weth.address);

    expect(interestRateStrategyAddressBefore).to.not.be.eq(ZERO_ADDRESS);
    expect(interestRateStrategyAddressAfter).to.be.eq(ZERO_ADDRESS);

    //reset interest rate strategy to the correct one
    await configurator
      .connect(poolAdmin.signer)
      .setReserveInterestRateStrategyAddress(
        weth.address,
        interestRateStrategyAddressBefore
      );
  });

  it("Updates the ReserveInterestRateStrategy address of WETH via risk admin", async () => {
    const {riskAdmin, pool, configurator, weth} = testEnv;

    const {interestRateStrategyAddress: interestRateStrategyAddressBefore} =
      await pool.getReserveData(weth.address);

    expect(
      await configurator
        .connect(riskAdmin.signer)
        .setReserveInterestRateStrategyAddress(weth.address, ONE_ADDRESS)
    )
      .to.emit(configurator, "ReserveInterestRateStrategyChanged")
      .withArgs(weth.address, interestRateStrategyAddressBefore, ONE_ADDRESS);
    const {interestRateStrategyAddress: interestRateStrategyAddressAfter} =
      await pool.getReserveData(weth.address);

    expect(interestRateStrategyAddressBefore).to.not.be.eq(ONE_ADDRESS);
    expect(interestRateStrategyAddressAfter).to.be.eq(ONE_ADDRESS);

    //reset interest rate strategy to the correct one
    await configurator
      .connect(riskAdmin.signer)
      .setReserveInterestRateStrategyAddress(
        weth.address,
        interestRateStrategyAddressBefore
      );
  });

  it("Register a new risk Admin", async () => {
    const {aclManager, poolAdmin, users, riskAdmin} = testEnv;

    const riskAdminRole = await aclManager.RISK_ADMIN_ROLE();

    const newRiskAdmin = users[3].address;
    expect(await aclManager.addRiskAdmin(newRiskAdmin))
      .to.emit(aclManager, "RoleGranted")
      .withArgs(riskAdminRole, newRiskAdmin, poolAdmin.address);

    expect(await aclManager.isRiskAdmin(riskAdmin.address)).to.be.true;
    expect(await aclManager.isRiskAdmin(newRiskAdmin)).to.be.true;
  });

  it("Unregister the new risk admin", async () => {
    const {aclManager, poolAdmin, users, riskAdmin} = testEnv;

    const riskAdminRole = await aclManager.RISK_ADMIN_ROLE();

    const newRiskAdmin = users[3].address;
    expect(await aclManager.removeRiskAdmin(newRiskAdmin))
      .to.emit(aclManager, "RoleRevoked")
      .withArgs(riskAdminRole, newRiskAdmin, poolAdmin.address);

    expect(await aclManager.isRiskAdmin(riskAdmin.address)).to.be.true;
    expect(await aclManager.isRiskAdmin(newRiskAdmin)).to.be.false;
  });

  it("Authorized a new flash borrower", async () => {
    const {aclManager, poolAdmin, users} = testEnv;

    const authorizedFlashBorrowerRole = await aclManager.FLASH_BORROWER_ROLE();

    const authorizedFlashBorrower = users[4].address;
    expect(await aclManager.addFlashBorrower(authorizedFlashBorrower))
      .to.emit(aclManager, "RoleGranted")
      .withArgs(
        authorizedFlashBorrowerRole,
        authorizedFlashBorrower,
        poolAdmin.address
      );

    expect(await aclManager.isFlashBorrower(authorizedFlashBorrower)).to.be
      .true;
  });

  it("Unauthorized flash borrower", async () => {
    const {aclManager, poolAdmin, users} = testEnv;

    const authorizedFlashBorrowerRole = await aclManager.FLASH_BORROWER_ROLE();

    const authorizedFlashBorrower = users[4].address;
    expect(await aclManager.removeFlashBorrower(authorizedFlashBorrower))
      .to.emit(aclManager, "RoleRevoked")
      .withArgs(
        authorizedFlashBorrowerRole,
        authorizedFlashBorrower,
        poolAdmin.address
      );

    expect(await aclManager.isFlashBorrower(authorizedFlashBorrower)).to.be
      .false;
  });

  // it("Updates bridge protocol fee equal to PERCENTAGE_FACTOR", async () => {
  //   const { pool, configurator } = testEnv;
  //   const newProtocolFee = 10000;

  //   const oldBridgeProtocolFee = await pool.BRIDGE_PROTOCOL_FEE();

  //   expect(await configurator.updateBridgeProtocolFee(newProtocolFee))
  //     .to.emit(configurator, "BridgeProtocolFeeUpdated")
  //     .withArgs(oldBridgeProtocolFee, newProtocolFee);

  //   expect(await pool.BRIDGE_PROTOCOL_FEE()).to.be.eq(newProtocolFee);
  // });

  // it("Updates bridge protocol fee", async () => {
  //   const { pool, configurator } = testEnv;

  //   const oldBridgeProtocolFee = await pool.BRIDGE_PROTOCOL_FEE();

  //   const newProtocolFee = 2000;

  //   expect(await configurator.updateBridgeProtocolFee(newProtocolFee))
  //     .to.emit(configurator, "BridgeProtocolFeeUpdated")
  //     .withArgs(oldBridgeProtocolFee, newProtocolFee);

  //   expect(await pool.BRIDGE_PROTOCOL_FEE()).to.be.eq(newProtocolFee);
  // });

  // it("Updates flash loan premiums equal to PERCENTAGE_FACTOR: 10000 toProtocol, 10000 total", async () => {
  //   const snapId = await evmSnapshot();

  //   const { pool, configurator } = testEnv;

  //   const oldFlashloanPremiumTotal = await pool.FLASHLOAN_PREMIUM_TOTAL();
  //   const oldFlashloanPremiumToProtocol =
  //     await pool.FLASHLOAN_PREMIUM_TO_PROTOCOL();

  //   const newPremiumTotal = 10000;
  //   const newPremiumToProtocol = 10000;

  //   expect(await configurator.updateFlashloanPremiumTotal(newPremiumTotal))
  //     .to.emit(configurator, "FlashloanPremiumTotalUpdated")
  //     .withArgs(oldFlashloanPremiumTotal, newPremiumTotal);
  //   expect(
  //     await configurator.updateFlashloanPremiumToProtocol(newPremiumToProtocol)
  //   )
  //     .to.emit(configurator, "FlashloanPremiumToProtocolUpdated")
  //     .withArgs(oldFlashloanPremiumToProtocol, newPremiumToProtocol);

  //   expect(await pool.FLASHLOAN_PREMIUM_TOTAL()).to.be.eq(newPremiumTotal);
  //   expect(await pool.FLASHLOAN_PREMIUM_TO_PROTOCOL()).to.be.eq(
  //     newPremiumToProtocol
  //   );

  //   await evmRevert(snapId);
  // });

  // it("Updates flash loan premiums: 10 toProtocol, 40 total", async () => {
  //   const { pool, configurator } = testEnv;

  //   const oldFlashloanPremiumTotal = await pool.FLASHLOAN_PREMIUM_TOTAL();
  //   const oldFlashloanPremiumToProtocol =
  //     await pool.FLASHLOAN_PREMIUM_TO_PROTOCOL();

  //   const newPremiumTotal = 40;
  //   const newPremiumToProtocol = 10;

  //   expect(await configurator.updateFlashloanPremiumTotal(newPremiumTotal))
  //     .to.emit(configurator, "FlashloanPremiumTotalUpdated")
  //     .withArgs(oldFlashloanPremiumTotal, newPremiumTotal);
  //   expect(
  //     await configurator.updateFlashloanPremiumToProtocol(newPremiumToProtocol)
  //   )
  //     .to.emit(configurator, "FlashloanPremiumToProtocolUpdated")
  //     .withArgs(oldFlashloanPremiumToProtocol, newPremiumToProtocol);

  //   expect(await pool.FLASHLOAN_PREMIUM_TOTAL()).to.be.eq(newPremiumTotal);
  //   expect(await pool.FLASHLOAN_PREMIUM_TO_PROTOCOL()).to.be.eq(
  //     newPremiumToProtocol
  //   );
  // });

  // it("Adds a new eMode category for stablecoins", async () => {
  //   const { configurator, pool, poolAdmin } = testEnv;

  //   expect(
  //     await configurator
  //       .connect(poolAdmin.signer)
  //       .setEModeCategory(
  //         "1",
  //         "9800",
  //         "9800",
  //         "10100",
  //         ONE_ADDRESS,
  //         "STABLECOINS"
  //       )
  //   )
  //     .to.emit(configurator, "EModeCategoryAdded")
  //     .withArgs(1, 9800, 9800, 10100, ONE_ADDRESS, "STABLECOINS");

  //   const categoryData = await pool.getEModeCategoryData(1);
  //   expect(categoryData.ltv).to.be.equal(9800, "invalid eMode category ltv");
  //   expect(categoryData.liquidationThreshold).to.be.equal(
  //     9800,
  //     "invalid eMode category liq threshold"
  //   );
  //   expect(categoryData.liquidationBonus).to.be.equal(
  //     10100,
  //     "invalid eMode category liq bonus"
  //   );
  //   expect(categoryData.priceSource).to.be.equal(
  //     ONE_ADDRESS,
  //     "invalid eMode category price source"
  //   );
  // });

  // it("Set a eMode category to an asset", async () => {
  //   const { configurator, pool, helpersContract, poolAdmin, dai } = testEnv;

  //   const oldCategoryId = await helpersContract.getReserveEModeCategory(
  //     dai.address
  //   );

  //   const newCategoryId = 1;

  //   expect(
  //     await configurator
  //       .connect(poolAdmin.signer)
  //       .setAssetEModeCategory(dai.address, "1")
  //   )
  //     .to.emit(configurator, "EModeAssetCategoryChanged")
  //     .withArgs(dai.address, oldCategoryId, newCategoryId);

  //   const categoryData = await pool.getEModeCategoryData(newCategoryId);
  //   expect(categoryData.ltv).to.be.equal(9800, "invalid eMode category ltv");
  //   expect(categoryData.liquidationThreshold).to.be.equal(
  //     9800,
  //     "invalid eMode category liq threshold"
  //   );
  //   expect(categoryData.liquidationBonus).to.be.equal(
  //     10100,
  //     "invalid eMode category liq bonus"
  //   );
  //   expect(categoryData.priceSource).to.be.equal(
  //     ONE_ADDRESS,
  //     "invalid eMode category price source"
  //   );
  // });

  it("Sets siloed borrowing through the pool admin", async () => {
    const {configurator, helpersContract, weth, poolAdmin} = testEnv;

    const oldSiloedBorrowing = await helpersContract.getSiloedBorrowing(
      weth.address
    );

    expect(
      await configurator
        .connect(poolAdmin.signer)
        .setSiloedBorrowing(weth.address, true)
    )
      .to.emit(configurator, "SiloedBorrowingChanged")
      .withArgs(weth.address, oldSiloedBorrowing, true);

    const newSiloedBorrowing = await helpersContract.getSiloedBorrowing(
      weth.address
    );

    expect(newSiloedBorrowing).to.be.eq(true, "Invalid siloed borrowing state");
  });

  it("Sets siloed borrowing through the risk admin", async () => {
    const {configurator, helpersContract, weth, riskAdmin} = testEnv;

    const oldSiloedBorrowing = await helpersContract.getSiloedBorrowing(
      weth.address
    );

    expect(
      await configurator
        .connect(riskAdmin.signer)
        .setSiloedBorrowing(weth.address, false)
    )
      .to.emit(configurator, "SiloedBorrowingChanged")
      .withArgs(weth.address, oldSiloedBorrowing, false);

    const newSiloedBorrowing = await helpersContract.getSiloedBorrowing(
      weth.address
    );

    expect(newSiloedBorrowing).to.be.eq(
      false,
      "Invalid siloed borrowing state"
    );
  });

  it("Resets the siloed borrowing mode. Tries to set siloed borrowing after the asset has been borrowed (revert expected)", async () => {
    const snap = await evmSnapshot();

    const {
      configurator,
      weth,
      dai,
      riskAdmin,
      pool,
      users: [user1, user2],
    } = testEnv;

    await configurator
      .connect(riskAdmin.signer)
      .setSiloedBorrowing(weth.address, false);

    const wethAmount = parseEther("1");
    const daiAmount = parseEther("1000");
    // user 1 supplies WETH
    await weth.connect(user1.signer)["mint(uint256)"](wethAmount);

    await weth.connect(user1.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await pool
      .connect(user1.signer)
      .supply(weth.address, wethAmount, user1.address, "0");

    // user 2 supplies DAI, borrows WETH
    await dai.connect(user2.signer)["mint(uint256)"](daiAmount);

    await dai.connect(user2.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await pool
      .connect(user2.signer)
      .supply(dai.address, daiAmount, user2.address, "0");

    await pool
      .connect(user2.signer)
      .borrow(weth.address, "100", 2, "0", user2.address);

    await expect(
      configurator.setSiloedBorrowing(weth.address, true)
    ).to.be.revertedWith(ProtocolErrors.RESERVE_DEBT_NOT_ZERO);

    await evmRevert(snap);
  });

  // it("Sets a debt ceiling through the pool admin", async () => {
  //   const { configurator, helpersContract, weth, poolAdmin } = testEnv;

  //   const oldDebtCeiling = await helpersContract.getDebtCeiling(weth.address);

  //   const newDebtCeiling = "1";
  //   expect(
  //     await configurator
  //       .connect(poolAdmin.signer)
  //       .setDebtCeiling(weth.address, newDebtCeiling)
  //   )
  //     .to.emit(configurator, "DebtCeilingChanged")
  //     .withArgs(weth.address, oldDebtCeiling, newDebtCeiling);

  //   const newCeiling = await helpersContract.getDebtCeiling(weth.address);

  //   expect(newCeiling).to.be.eq(newDebtCeiling, "Invalid debt ceiling");
  // });

  // it("Sets a debt ceiling through the risk admin", async () => {
  //   const { configurator, helpersContract, weth, riskAdmin } = testEnv;

  //   const oldDebtCeiling = await helpersContract.getDebtCeiling(weth.address);

  //   const newDebtCeiling = "10";
  //   expect(
  //     await configurator
  //       .connect(riskAdmin.signer)
  //       .setDebtCeiling(weth.address, newDebtCeiling)
  //   )
  //     .to.emit(configurator, "DebtCeilingChanged")
  //     .withArgs(weth.address, oldDebtCeiling, newDebtCeiling);

  //   const newCeiling = await helpersContract.getDebtCeiling(weth.address);

  //   expect(newCeiling).to.be.eq(newDebtCeiling, "Invalid debt ceiling");
  // });

  // it("Sets a debt ceiling larger than max (revert expected)", async () => {
  //   const { configurator, helpersContract, weth, riskAdmin } = testEnv;

  //   const MAX_VALID_DEBT_CEILING = BigNumber.from("1099511627775");
  //   const debtCeiling = MAX_VALID_DEBT_CEILING.add(1);

  //   const currentCeiling = await helpersContract.getDebtCeiling(weth.address);

  //   await expect(
  //     configurator
  //       .connect(riskAdmin.signer)
  //       .setDebtCeiling(weth.address, debtCeiling)
  //   ).to.be.revertedWith(INVALID_DEBT_CEILING);

  //   const newCeiling = await helpersContract.getDebtCeiling(weth.address);
  //   expect(newCeiling).to.be.eq(currentCeiling, "Invalid debt ceiling");
  // });

  // it("Resets the WETH debt ceiling. Tries to set debt ceiling after liquidity has been provided (revert expected)", async () => {
  //   const {
  //     configurator,
  //     weth,
  //     riskAdmin,
  //     pool,
  //     users: [user1],
  //   } = testEnv;

  //   await configurator
  //     .connect(riskAdmin.signer)
  //     .setDebtCeiling(weth.address, "0");

  //   // user 1 deposits
  //   await weth.connect(user1.signer)["mint(uint256)"]("100");

  //   await weth.connect(user1.signer).approve(pool.address, MAX_UINT_AMOUNT);

  //   await pool
  //     .connect(user1.signer)
  //     .supply(weth.address, "100", user1.address, "0");

  //   await expect(
  //     configurator.setDebtCeiling(weth.address, "100")
  //   ).to.be.revertedWith(RESERVE_LIQUIDITY_NOT_ZERO);
  // });

  // it("Withdraws supplied liquidity, sets WETH debt ceiling", async () => {
  //   const {
  //     configurator,
  //     helpersContract,
  //     weth,
  //     riskAdmin,
  //     pool,
  //     users: [user1],
  //   } = testEnv;

  //   await pool
  //     .connect(user1.signer)
  //     .withdraw(weth.address, MAX_UINT_AMOUNT, user1.address);

  //   await configurator
  //     .connect(riskAdmin.signer)
  //     .setDebtCeiling(weth.address, "100");

  //   const newCeiling = await helpersContract.getDebtCeiling(weth.address);

  //   expect(newCeiling).to.be.eq("100");
  // });

  // it("Readds liquidity, increases WETH debt ceiling", async () => {
  //   const {
  //     configurator,
  //     helpersContract,
  //     weth,
  //     riskAdmin,
  //     pool,
  //     users: [user1],
  //   } = testEnv;

  //   await pool
  //     .connect(user1.signer)
  //     .supply(weth.address, "100", user1.address, "0");

  //   await configurator
  //     .connect(riskAdmin.signer)
  //     .setDebtCeiling(weth.address, "200");

  //   const newCeiling = await helpersContract.getDebtCeiling(weth.address);

  //   expect(newCeiling).to.be.eq("200");
  // });

  // it("Read debt ceiling decimals", async () => {
  //   const { helpersContract } = testEnv;
  //   expect(await helpersContract.getDebtCeilingDecimals()).to.be.eq(2);
  // });
});
