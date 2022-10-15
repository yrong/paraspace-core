import {expect} from "chai";
import {getMockAggregator} from "../deploy/helpers/contracts-getters";
import {TestEnv} from "./helpers/make-suite";
import {
  borrowAndValidate,
  changePriceAndValidate,
  liquidateAndValidate,
  liquidateAndValidateReverted,
  supplyAndValidate,
  switchCollateralAndValidate,
} from "./helpers/validated-steps";
import {snapshot} from "./helpers/snapshot-manager";
import {setBlocktime, waitForTx} from "../deploy/helpers/misc-utils";
import {BigNumber} from "ethers";
import {ProtocolErrors} from "../deploy/helpers/types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {testEnvFixture} from "./helpers/setup-env";

let snapthotId: string;

describe("Liquidation Tests: NonBorrowed Asset", () => {
  let testEnv: TestEnv;
  before("Setup Borrower and Liquidator positions", async () => {
    testEnv = await loadFixture(testEnvFixture);
    const {
      users: [borrower, liquidator],
      bayc,
      dai,
      weth,
    } = testEnv;

    // assure asset prices for correct health factor calculations
    await changePriceAndValidate(bayc, "101");

    const daiAgg = await getMockAggregator(undefined, "DAI");
    await daiAgg.updateLatestAnswer("908578801039414");

    // Borrower deposits 3 BAYC and 5k DAI
    await supplyAndValidate(bayc, "3", borrower, true);

    await supplyAndValidate(dai, "5000", borrower, true);
    // use only one BAYC as collateral
    await switchCollateralAndValidate(borrower, bayc, false, 1);
    await switchCollateralAndValidate(borrower, bayc, false, 2);

    // Liquidator deposits 100k DAI and 10 wETH
    await supplyAndValidate(weth, "10", liquidator, true, "20");
    await supplyAndValidate(dai, "100000", liquidator, true, "200000");

    // Borrower borrows 15k DAI
    await borrowAndValidate(dai, "15000", borrower);
  });

  beforeEach("Take Blockchain Snapshot", async () => {
    snapthotId = await snapshot.take();
  });

  afterEach("Revert Blockchain to Snapshot", async () => {
    await snapshot.revert(snapthotId);
  });

  it("Liquidator liquidates the ERC-721 with non-borrowed token - gets NFT", async () => {
    const {
      users: [borrower, liquidator],
      pool,
      bayc,
      nBAYC,
      dai,
      weth,
    } = testEnv;

    // NFT HF < 1 borrower's NFT becomes eligible for liquidation
    await changePriceAndValidate(bayc, "1");

    // start auction
    await waitForTx(
      await pool
        .connect(liquidator.signer)
        .startAuction(borrower.address, bayc.address, 0)
    );
    const {startTime, tickLength} = await pool.getAuctionData(nBAYC.address, 0);
    await setBlocktime(
      startTime.add(tickLength.mul(BigNumber.from(40))).toNumber()
    );
    expect((await nBAYC.getAuctionData(0)).startTime).to.be.gt(0);

    await liquidateAndValidate(
      bayc,
      weth,
      "10",
      liquidator,
      borrower,
      false,
      0
    );

    // expect(await (await nBAYC.getAuctionData(0)).startTime).to.be.eq(0);

    // // Borrower tries to withdraw the deposited BAYC after liquidation (should fail)
    // await expect(
    //   pool
    //     .connect(borrower.signer)
    //     .withdrawERC721(bayc.address, [0], borrower.address)
    // ).to.be.revertedWith("not the owner of Ntoken");

    // // Liquidator tries to liquidate same NFT again (should fail)
    // await liquidateAndValidateReverted(
    //   bayc,
    //   dai,
    //   "10000",
    //   liquidator,
    //   borrower,
    //   false,
    //   ProtocolErrors.AUCTION_NOT_STARTED,
    //   1
    // );
  });
});
