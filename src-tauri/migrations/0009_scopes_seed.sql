-- Seed des scopes/ranks de réputation (port fidèle de resources/scopes-seed.json V1).
-- 9 scopes / 55 ranks. Données de référence statiques (ni API, ni datamining).
-- Idempotent : la migration s'exécute une fois (versioning) et INSERT OR IGNORE évite
-- tout doublon si réappliqué. id de scope = scopeName ; id de rank = scopeName-rankIndex.

INSERT OR IGNORE INTO Scope (id, scopeName, displayName) VALUES
  ('FactionReputation',                'FactionReputation',                'Faction Reputation'),
  ('Affinity',                         'Affinity',                         'Affinity'),
  ('Assassination',                    'Assassination',                    'Assassination'),
  ('BountyHunter',                     'BountyHunter',                     'Bounty Hunter (General)'),
  ('BountyHunter_BountyHuntersGuild',  'BountyHunter_BountyHuntersGuild',  'Bounty Hunter (Guild)'),
  ('Hauling',                          'Hauling',                          'Hauling'),
  ('Security',                         'Security',                         'Security'),
  ('ShipCombat_HeadHunters',           'ShipCombat_HeadHunters',           'Headhunters'),
  ('Wikelo',                           'Wikelo',                           'Wikelo Emporium');

INSERT OR IGNORE INTO Rank (id, scopeId, name, nameKey, minReputation, rangeXP, rankIndex) VALUES
  -- FactionReputation
  ('FactionReputation-0', 'FactionReputation', 'Neutral',            '@mobiGlas_Reputation_Stance_Neutral', 0,     800,   0),
  ('FactionReputation-1', 'FactionReputation', 'Jr. Contractor',     '@RepScope_Contractor_Rank1',          800,   1400,  1),
  ('FactionReputation-2', 'FactionReputation', 'Contractor',         '@RepScope_Contractor_Rank2',          2200,  3600,  2),
  ('FactionReputation-3', 'FactionReputation', 'Sr. Contractor',     '@RepScope_Contractor_Rank3',          5800,  9200,  3),
  ('FactionReputation-4', 'FactionReputation', 'Veteran Contractor', '@RepScope_Contractor_Rank4',          15000, 23000, 4),
  ('FactionReputation-5', 'FactionReputation', 'Head Contractor',    '@RepScope_Contractor_Rank5',          38000, 57250, 5),
  ('FactionReputation-6', 'FactionReputation', 'Elite Contractor',   '@RepScope_Contractor_Rank6',          95250, NULL,  6),
  -- Affinity
  ('Affinity-0', 'Affinity', 'Neutral', '@RepStanding_MissionGiver_Default_Neutral_Name', 0,     500,  0),
  ('Affinity-1', 'Affinity', 'Liked',   '@RepStanding_MissionGiver_Default_Liked_Name',   2500,  500,  1),
  ('Affinity-2', 'Affinity', 'Exalted', '@RepStanding_MissionGiver_Default_Exalted_Name', 10000, NULL, 2),
  -- Assassination
  ('Assassination-0', 'Assassination', 'Under Review',         '@RepStanding_Assassination_Rank0', 0,      1,     0),
  ('Assassination-1', 'Assassination', 'Assassin In Training', '@RepStanding_Assassination_Rank1', 1,      2999,  1),
  ('Assassination-2', 'Assassination', 'Low Level Assassin',   '@RepStanding_Assassination_Rank2', 3000,   5000,  2),
  ('Assassination-3', 'Assassination', 'Assassin',             '@RepStanding_Assassination_Rank3', 8000,   16000, 3),
  ('Assassination-4', 'Assassination', 'High Value Assassin',  '@RepStanding_Assassination_Rank4', 24000,  32000, 4),
  ('Assassination-5', 'Assassination', 'Elite Assassin',       '@RepStanding_Assassination_Rank5', 56000,  56000, 5),
  ('Assassination-6', 'Assassination', 'Master Assassin',      '@RepStanding_Assassination_Rank6', 112000, NULL,  6),
  -- BountyHunter (General)
  ('BountyHunter-0', 'BountyHunter', 'Applicant',         '@RepStanding_Bounty_Rank0', 0,       1,       0),
  ('BountyHunter-1', 'BountyHunter', 'Tracker Trainee',   '@RepStanding_Bounty_Rank1', 1,       4999,    1),
  ('BountyHunter-2', 'BountyHunter', 'Associate Tracker', '@RepStanding_Bounty_Rank2', 5000,    25000,   2),
  ('BountyHunter-3', 'BountyHunter', 'Tracker',           '@RepStanding_Bounty_Rank3', 30000,   90000,   3),
  ('BountyHunter-4', 'BountyHunter', 'Advanced Tracker',  '@RepStanding_Bounty_Rank4', 120000,  360000,  4),
  ('BountyHunter-5', 'BountyHunter', 'Senior Tracker',    '@RepStanding_Bounty_Rank5', 480000,  1120000, 5),
  ('BountyHunter-6', 'BountyHunter', 'Master Tracker',    '@RepStanding_Bounty_Rank6', 1600000, NULL,    6),
  -- BountyHunter (Guild)
  ('BountyHunter_BountyHuntersGuild-0', 'BountyHunter_BountyHuntersGuild', 'Applicant',                 '@RepStanding_Bounty_Applicant_Name',            0,      1,      0),
  ('BountyHunter_BountyHuntersGuild-1', 'BountyHunter_BountyHuntersGuild', 'Probationary Guild Member', '@RepStanding_Bounty_Probation_Name',            1,      2999,   1),
  ('BountyHunter_BountyHuntersGuild-2', 'BountyHunter_BountyHuntersGuild', 'Junior Guild Member',       '@RepStanding_Bounty_Junior_Name',               3000,   7000,   2),
  ('BountyHunter_BountyHuntersGuild-3', 'BountyHunter_BountyHuntersGuild', 'Guild Member',              '@RepStanding_Bounty_MidLevel_Name',             10000,  30000,  3),
  ('BountyHunter_BountyHuntersGuild-4', 'BountyHunter_BountyHuntersGuild', 'Senior Guild Member',       '@RepStanding_Bounty_Senior_Name',               40000,  160000, 4),
  ('BountyHunter_BountyHuntersGuild-5', 'BountyHunter_BountyHuntersGuild', 'Veteran Guild Member',      '@RepStanding_Bounty_MasterBountyHunter_Name',   200000, 280000, 5),
  ('BountyHunter_BountyHuntersGuild-6', 'BountyHunter_BountyHuntersGuild', 'Guild Steward',             '@RepStanding_Bounty_LegendaryBountyHunter_Name',480000, NULL,   6),
  -- Hauling
  ('Hauling-0', 'Hauling', 'Trainee',     '@RepStanding_TransportGuild_Rank0', 0,      50,     0),
  ('Hauling-1', 'Hauling', 'Rookie',      '@RepStanding_TransportGuild_Rank1', 50,     200,    1),
  ('Hauling-2', 'Hauling', 'Junior',      '@RepStanding_TransportGuild_Rank2', 250,    5000,   2),
  ('Hauling-3', 'Hauling', 'Member',      '@RepStanding_TransportGuild_Rank3', 5250,   22500,  3),
  ('Hauling-4', 'Hauling', 'Experienced', '@RepStanding_TransportGuild_Rank4', 27750,  50000,  4),
  ('Hauling-5', 'Hauling', 'Senior',      '@RepStanding_TransportGuild_Rank5', 77750,  160000, 5),
  ('Hauling-6', 'Hauling', 'Master',      '@RepStanding_TransportGuild_Rank6', 237750, NULL,   6),
  -- Security
  ('Security-0', 'Security', 'Applicant',                 '@RepStanding_Security_Rank0', 0,       1,       0),
  ('Security-1', 'Security', 'Security Trainee',          '@RepStanding_Security_Rank1', 1,       4999,    1),
  ('Security-2', 'Security', 'Jr. Security Contractor',   '@RepStanding_Security_Rank2', 5000,    25000,   2),
  ('Security-3', 'Security', 'Security Contractor',       '@RepStanding_Security_Rank3', 30000,   90000,   3),
  ('Security-4', 'Security', 'Sr. Security Contractor',   '@RepStanding_Security_Rank4', 120000,  360000,  4),
  ('Security-5', 'Security', 'Lead Security Contractor',  '@RepStanding_Security_Rank5', 480000,  1120000, 5),
  ('Security-6', 'Security', 'Elite Security Contractor', '@RepStanding_Security_Rank6', 1600000, NULL,    6),
  -- ShipCombat_HeadHunters
  ('ShipCombat_HeadHunters-0', 'ShipCombat_HeadHunters', 'Applicant', '@RepStanding_Rank0', 0,      1,      0),
  ('ShipCombat_HeadHunters-1', 'ShipCombat_HeadHunters', 'Rank I',    '@RepStanding_Rank1', 1,      2999,   1),
  ('ShipCombat_HeadHunters-2', 'ShipCombat_HeadHunters', 'Rank II',   '@RepStanding_Rank2', 3000,   7000,   2),
  ('ShipCombat_HeadHunters-3', 'ShipCombat_HeadHunters', 'Rank III',  '@RepStanding_Rank3', 10000,  30000,  3),
  ('ShipCombat_HeadHunters-4', 'ShipCombat_HeadHunters', 'Rank IV',   '@RepStanding_Rank4', 40000,  160000, 4),
  ('ShipCombat_HeadHunters-5', 'ShipCombat_HeadHunters', 'Rank V',    '@RepStanding_Rank5', 200000, 280000, 5),
  ('ShipCombat_HeadHunters-6', 'ShipCombat_HeadHunters', 'Rank VI',   '@RepStanding_Rank6', 480000, NULL,   6),
  -- Wikelo
  ('Wikelo-0', 'Wikelo', 'New Customer',       '@RepStanding_Barter_Rank0_Name', 0,   340,  0),
  ('Wikelo-1', 'Wikelo', 'Very Good Customer', '@RepStanding_Barter_Rank1_Name', 340, 659,  1),
  ('Wikelo-2', 'Wikelo', 'Very Best Customer', '@RepStanding_Barter_Rank2_Name', 999, NULL, 2);
