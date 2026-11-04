-- The specification of InstantRedemption: one theorem per file.

-- P1: pricing
import Spiko.InstantRedemption.Specifications.PreviewRedeemOk
import Spiko.InstantRedemption.Specifications.PreviewRedeemFloor
import Spiko.InstantRedemption.Specifications.PreviewRedeemMonoAmount
import Spiko.InstantRedemption.Specifications.PreviewRedeemMonoPrice
-- P2: daily limit
import Spiko.InstantRedemption.Specifications.RedeemOutputMin
import Spiko.InstantRedemption.Specifications.RedeemWithinLimit
import Spiko.InstantRedemption.Specifications.DailyLimit
-- P3: conservation
import Spiko.InstantRedemption.Specifications.RedeemBalancesExact
import Spiko.InstantRedemption.Specifications.RedeemBalances
import Spiko.InstantRedemption.Specifications.RedeemStorage
-- Liveness
import Spiko.InstantRedemption.Specifications.RedeemSucceeds
-- P4: access control
import Spiko.InstantRedemption.Specifications.CallRestricted
-- P5: salt
import Spiko.InstantRedemption.Specifications.RedeemMarksUsed
import Spiko.InstantRedemption.Specifications.RedeemRejectsUsed
import Spiko.InstantRedemption.Specifications.ExecKeepsUsed
