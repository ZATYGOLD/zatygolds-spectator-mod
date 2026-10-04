-- config/observer-setup-rules.sql
-- Author: Zatygold

--*******************************************************
--************* OBSERVER CIVILIZATION PAIRING ***********
--*******************************************************
-- No other leader (nor a Random one) supports an Observer civilization, so a
-- Random civilization never resolves to one for a player who is not the
-- Observer. ui/setup/setup-observer.js applies the same rule to the setup
-- screens and pairs the Observer leader with its civilization.
INSERT INTO UnSupportedValuesByPlayerLeader (LeaderDomain, LeaderType, Domain, Value)
    SELECT l.Domain, l.LeaderType, 'StandardCivilizations', c.CivilizationType
    FROM (SELECT DISTINCT Domain, LeaderType FROM Leaders WHERE LeaderType <> 'LEADER_ZOM_OBSERVER'
          UNION SELECT 'StandardLeaders', 'RANDOM') AS l
    CROSS JOIN (SELECT DISTINCT CivilizationType FROM Civilizations WHERE CivilizationType LIKE 'CIVILIZATION_ZOM_OBSERVER_%') AS c;
