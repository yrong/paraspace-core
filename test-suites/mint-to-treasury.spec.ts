import {expect} from "chai";
import {RateMode} from "../deploy/helpers/types";
import {MAX_UINT_AMOUNT, ONE_YEAR} from "../deploy/helpers/constants";
import {convertToCurrencyDecimals} from "../deploy/helpers/contracts-helpers";
import {advanceTimeAndBlock} from "../deploy/helpers/misc-utils";
import {makeSuite, TestEnv} from "./helpers/make-suite";
import "./helpers/utils/wadraymath";

makeSuite("Mint To Treasury", (testEnv: TestEnv) => {
  it("User 0 deposits 1000 DAI. Borrower borrows 100 DAI. Clock moved forward one year. Calculates and verifies the amount accrued to the treasury", async () => {
    const {users, pool, dai, helpersContract} = testEnv;

    const amountDAItoDeposit = await convertToCurrencyDecimals(
      dai.address,
      "1000"
    );
    const amountDAItoBorrow = await convertToCurrencyDecimals(
      dai.address,
      "100"
    );

    await expect(
      await dai.connect(users[0].signer)["mint(uint256)"](amountDAItoDeposit)
    );

    // user 0 deposits 1000 DAI
    await expect(
      await dai.connect(users[0].signer).approve(pool.address, MAX_UINT_AMOUNT)
    );
    await expect(
      await pool
        .connect(users[0].signer)
        .supply(dai.address, amountDAItoDeposit, users[0].address, "0")
    );

    await expect(
      await pool
        .connect(users[0].signer)
        .borrow(
          dai.address,
          amountDAItoBorrow,
          RateMode.Variable,
          "0",
          users[0].address
        )
    );

    const {reserveFactor} = await helpersContract.getReserveConfigurationData(
      dai.address
    );

    await advanceTimeAndBlock(parseInt(ONE_YEAR));

    await expect(
      await dai.connect(users[0].signer)["mint(uint256)"](amountDAItoDeposit)
    );

    await expect(
      await pool
        .connect(users[0].signer)
        .supply(dai.address, amountDAItoDeposit, users[0].address, "0")
    );

    const {liquidityIndex, variableBorrowIndex} = await pool.getReserveData(
      dai.address
    );

    const expectedAccruedToTreasury = amountDAItoBorrow
      .rayMul(variableBorrowIndex)
      .sub(amountDAItoBorrow)
      .percentMul(reserveFactor)
      .rayDiv(liquidityIndex);

    const {accruedToTreasury} = await pool.getReserveData(dai.address);

    expect(accruedToTreasury).to.be.closeTo(expectedAccruedToTreasury, 2);
  });

  it("Mints the accrued to the treasury", async () => {
    const {users, pool, dai, pDai} = testEnv;

    const treasuryAddress = await pDai.RESERVE_TREASURY_ADDRESS();
    const {accruedToTreasury} = await pool.getReserveData(dai.address);

    await expect(
      await pool.connect(users[0].signer).mintToTreasury([dai.address])
    );

    const normalizedIncome = await pool.getReserveNormalizedIncome(dai.address);
    const treasuryBalance = await pDai.balanceOf(treasuryAddress);

    const expectedTreasuryBalance = accruedToTreasury.rayMul(normalizedIncome);

    expect(treasuryBalance).to.be.closeTo(
      expectedTreasuryBalance,
      2,
      "Invalid treasury balance after minting"
    );
  });
});
