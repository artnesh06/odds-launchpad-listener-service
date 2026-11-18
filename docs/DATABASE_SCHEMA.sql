-- ============================================
-- ENUM TYPES
-- ============================================

-- DROP TYPE public."ActivityType";

CREATE TYPE public."ActivityType" AS ENUM (
	'FACTORY_CREATED',
	'LAUNCHPAD_CREATED',
	'LAUNCHPAD_UPDATED',
	'MINT_OCCURRED',
	'PHASE_CREATED',
	'PHASE_UPDATED',
	'FEE_UPDATED',
	'TREASURY_UPDATED',
	'OWNERSHIP_TRANSFERRED',
	'EMERGENCY_WITHDRAW',
	'BURN_OCCURRED',
	'AIRDROP_OCCURRED',
	'COLLECTION_REVEALED',
	'ROYALTY_UPDATED',
	'METADATA_UPDATED',
	'CONTRACT_PAUSED',
	'CONTRACT_UNPAUSED',
	'TRANSFER_LOCK_UPDATED',
	'ROLE_GRANTED',
	'ROLE_REVOKED');

-- DROP TYPE public."AdminRole";

CREATE TYPE public."AdminRole" AS ENUM (
	'SUPER_ADMIN',
	'ADMIN',
	'MODERATOR',
	'VIEWER');

-- DROP TYPE public."BannerStatus";

CREATE TYPE public."BannerStatus" AS ENUM (
	'ACTIVE',
	'INACTIVE',
	'SCHEDULED');

-- DROP TYPE public."BannerType";

CREATE TYPE public."BannerType" AS ENUM (
	'IMAGE',
	'VIDEO');

-- DROP TYPE public."BulkOperationType";

CREATE TYPE public."BulkOperationType" AS ENUM (
	'CREATE_LAUNCHPADS',
	'UPDATE_FEES',
	'UPDATE_TREASURIES',
	'EXPORT_DATA');

-- DROP TYPE public."BulkStatus";

CREATE TYPE public."BulkStatus" AS ENUM (
	'PENDING',
	'RUNNING',
	'PAUSED',
	'COMPLETED',
	'FAILED',
	'CANCELLED');

-- DROP TYPE public."LaunchpadStatus";

CREATE TYPE public."LaunchpadStatus" AS ENUM (
	'ACTIVE',
	'PAUSED',
	'COMPLETED',
	'CANCELLED');

-- DROP TYPE public."ListingStatus";

CREATE TYPE public."ListingStatus" AS ENUM (
	'ACTIVE',
	'SOLD',
	'CANCELLED',
	'EXPIRED');

-- DROP TYPE public."Marketplace";

CREATE TYPE public."Marketplace" AS ENUM (
	'OPENSEA',
	'SEAPORT',
	'MAGIC_EDEN',
	'BLUR',
	'LOOKSRARE',
	'X2Y2',
	'RARIBLE',
	'UNKNOWN');

-- DROP TYPE public."OfferStatus";

CREATE TYPE public."OfferStatus" AS ENUM (
	'ACTIVE',
	'ACCEPTED',
	'CANCELLED',
	'EXPIRED');

-- DROP TYPE public."PhaseType";

CREATE TYPE public."PhaseType" AS ENUM (
	'PRESALE',
	'PUBLIC',
	'ALLOWLIST',
	'FREE');

-- DROP TYPE public."PromoRequestStatus";

CREATE TYPE public."PromoRequestStatus" AS ENUM (
	'PENDING',
	'APPROVED',
	'REJECTED');

-- DROP TYPE public."SettingType";

CREATE TYPE public."SettingType" AS ENUM (
	'STRING',
	'NUMBER',
	'BOOLEAN',
	'JSON');

-- DROP TYPE public."TransferType";

CREATE TYPE public."TransferType" AS ENUM (
	'MINT',
	'TRANSFER',
	'BURN');

-- Array types are automatically created by PostgreSQL when you create ENUM types
-- No need to manually define _ActivityType, _AdminRole, etc.


-- public."_prisma_migrations" definition

-- Drop table

-- DROP TABLE public."_prisma_migrations";

CREATE TABLE public."_prisma_migrations" (
	id varchar(36) NOT NULL,
	checksum varchar(64) NOT NULL,
	finished_at timestamptz NULL,
	migration_name varchar(255) NOT NULL,
	logs text NULL,
	rolled_back_at timestamptz NULL,
	started_at timestamptz NOT NULL DEFAULT now(),
	applied_steps_count int4 NOT NULL DEFAULT 0,
	CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY (id)
);


-- public.admin_activity_logs definition

-- Drop table

-- DROP TABLE public.admin_activity_logs;

CREATE TABLE public.admin_activity_logs (
	id varchar(25) NOT NULL,
	"operationType" varchar(50) NOT NULL,
	status varchar(20) NOT NULL,
	"chainId" int4 NULL,
	"contractAddress" varchar(42) NULL,
	"startedAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"completedAt" timestamp NULL,
	duration int4 NULL,
	"itemsProcessed" int4 NOT NULL DEFAULT 0,
	"itemsFailed" int4 NOT NULL DEFAULT 0,
	"errorMessage" text NULL,
	metadata json NULL,
	CONSTRAINT admin_activity_logs_pkey PRIMARY KEY (id)
);
CREATE INDEX "idx_chainId_contractAddress" ON public.admin_activity_logs USING btree ("chainId", "contractAddress");
CREATE INDEX "idx_operationType_status" ON public.admin_activity_logs USING btree ("operationType", status);
CREATE INDEX "idx_startedAt" ON public.admin_activity_logs USING btree ("startedAt");
CREATE INDEX "idx_status_startedAt" ON public.admin_activity_logs USING btree (status, "startedAt");


-- public.admin_users definition

-- Drop table

-- DROP TABLE public.admin_users;

CREATE TABLE public.admin_users (
	id text NOT NULL,
	address text NOT NULL,
	"role" public."AdminRole" NOT NULL DEFAULT 'ADMIN'::"AdminRole",
	"isActive" bool NOT NULL DEFAULT true,
	"lastActiveAt" timestamp(3) NULL,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3) NOT NULL,
	CONSTRAINT admin_users_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX admin_users_address_key ON public.admin_users USING btree (address);


-- public.bulk_operations definition

-- Drop table

-- DROP TABLE public.bulk_operations;

CREATE TABLE public.bulk_operations (
	id text NOT NULL,
	name text NOT NULL,
	"type" public."BulkOperationType" NOT NULL,
	status public."BulkStatus" NOT NULL DEFAULT 'PENDING'::"BulkStatus",
	progress int4 NOT NULL DEFAULT 0,
	total int4 NOT NULL,
	processed int4 NOT NULL DEFAULT 0,
	errors _jsonb NULL DEFAULT ARRAY[]::jsonb[],
	"data" jsonb NOT NULL,
	"result" jsonb NULL,
	"startedAt" timestamp(3) NULL,
	"completedAt" timestamp(3) NULL,
	"createdBy" text NOT NULL,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3) NOT NULL,
	CONSTRAINT bulk_operations_pkey PRIMARY KEY (id)
);


-- public.chains definition

-- Drop table

-- DROP TABLE public.chains;

CREATE TABLE public.chains (
	id serial4 NOT NULL,
	"chainId" int4 NOT NULL,
	name text NOT NULL,
	network text NOT NULL,
	"rpcUrl" text NOT NULL,
	"blockExplorer" text NOT NULL,
	"nativeCurrencyName" text NOT NULL,
	"nativeCurrencySymbol" text NOT NULL,
	"nativeCurrencyDecimals" int4 NOT NULL,
	"isTestnet" bool NOT NULL DEFAULT false,
	icon text NULL,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3) NOT NULL,
	CONSTRAINT chains_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX "chains_chainId_key" ON public.chains USING btree ("chainId");


-- public.error_logs definition

-- Drop table

-- DROP TABLE public.error_logs;

CREATE TABLE public.error_logs (
	id text NOT NULL,
	"errorType" text NOT NULL,
	severity text NOT NULL,
	message text NOT NULL,
	stack text NULL,
	component text NOT NULL,
	operation text NOT NULL,
	"chainId" int4 NULL,
	"contractAddress" text NULL,
	"tokenId" text NULL,
	"txHash" text NULL,
	"blockNumber" int4 NULL,
	metadata jsonb NULL,
	resolved bool NOT NULL DEFAULT false,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT error_logs_pkey PRIMARY KEY (id)
);
CREATE INDEX error_logs_component_operation_idx ON public.error_logs USING btree (component, operation);
CREATE INDEX "error_logs_createdAt_idx" ON public.error_logs USING btree ("createdAt");
CREATE INDEX "error_logs_errorType_severity_idx" ON public.error_logs USING btree ("errorType", severity);


-- public.processed_events definition

-- Drop table

-- DROP TABLE public.processed_events;

CREATE TABLE public.processed_events (
	id text NOT NULL,
	"transactionHash" text NOT NULL,
	"logIndex" int4 NOT NULL,
	"processedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT processed_events_pkey PRIMARY KEY (id)
);
CREATE INDEX "processed_events_processedAt_idx" ON public.processed_events USING btree ("processedAt");
CREATE UNIQUE INDEX "processed_events_transactionHash_logIndex_key" ON public.processed_events USING btree ("transactionHash", "logIndex");


-- public.promo_requests definition

-- Drop table

-- DROP TABLE public.promo_requests;

CREATE TABLE public.promo_requests (
	id text NOT NULL,
	"promoCode" text NOT NULL,
	"collectionName" text NOT NULL,
	"collectionAddress" text NULL,
	creator text NOT NULL,
	"chainId" int4 NOT NULL,
	"chainName" text NOT NULL,
	image text NULL,
	thumbnail text NULL,
	twitter text NULL,
	discord text NULL,
	telegram text NULL,
	description text NULL,
	status public."PromoRequestStatus" NOT NULL DEFAULT 'PENDING'::"PromoRequestStatus",
	"rejectionReason" text NULL,
	"bannerId" text NULL,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3) NOT NULL,
	CONSTRAINT promo_requests_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX "promo_requests_promoCode_key" ON public.promo_requests USING btree ("promoCode");
CREATE INDEX "promo_requests_status_createdAt_idx" ON public.promo_requests USING btree (status, "createdAt");


-- public.launchpad_factories definition

-- Drop table

-- DROP TABLE public.launchpad_factories;

CREATE TABLE public.launchpad_factories (
	id text NOT NULL,
	"chainId" int4 NOT NULL,
	"contractAddress" text NOT NULL,
	"version" text NOT NULL,
	"deployedChainId" int4 NOT NULL,
	"owner" text NOT NULL,
	treasury text NOT NULL,
	"creationFee" text NOT NULL,
	"platformFeePercentage" int4 NOT NULL,
	"freeMintFee" text NOT NULL,
	"totalLaunchpads" int4 NOT NULL DEFAULT 0,
	"isActive" bool NOT NULL DEFAULT true,
	"deployedAt" timestamp(3) NULL,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3) NOT NULL,
	"lastProcessedBlock" int4 NULL,
	"lastProcessedBlockAt" timestamp(3) NULL,
	CONSTRAINT launchpad_factories_pkey PRIMARY KEY (id),
	CONSTRAINT "launchpad_factories_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES public.chains("chainId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "launchpad_factories_contractAddress_key" ON public.launchpad_factories USING btree ("contractAddress");
CREATE INDEX "launchpad_factories_lastProcessedBlock_idx" ON public.launchpad_factories USING btree ("lastProcessedBlock");


-- public.launchpads definition

-- Drop table

-- DROP TABLE public.launchpads;

CREATE TABLE public.launchpads (
	id text NOT NULL,
	"chainId" int4 NOT NULL,
	"factoryId" text NOT NULL,
	"contractAddress" text NOT NULL,
	creator text NOT NULL,
	name text NOT NULL,
	symbol text NOT NULL,
	description text NULL,
	"baseURI" text NULL,
	"unrevealedURI" text NULL,
	"contractURI" text NULL,
	"externalLink" text NULL,
	"totalMaxSupply" int4 NOT NULL,
	"mintedCount" int4 NOT NULL DEFAULT 0,
	treasury text NOT NULL,
	"royaltyRecipient" text NULL,
	"royaltyPercentage" int4 NOT NULL DEFAULT 0,
	status public."LaunchpadStatus" NOT NULL DEFAULT 'ACTIVE'::"LaunchpadStatus",
	volume text NOT NULL DEFAULT '0'::text,
	"lastMintAt" timestamp(3) NULL,
	"deployTxHash" text NULL,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3) NOT NULL,
	"lastSyncAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"manifestHash" text NULL,
	"imageManifestHash" text NULL,
	"isFeatured" bool NOT NULL DEFAULT false,
	"isShuffleEnabled" bool NOT NULL DEFAULT false,
	CONSTRAINT launchpads_pkey PRIMARY KEY (id),
	CONSTRAINT "launchpads_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES public.chains("chainId") ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT "launchpads_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES public.launchpad_factories(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "launchpads_chainId_createdAt_idx" ON public.launchpads USING btree ("chainId", "createdAt");
CREATE INDEX "launchpads_chainId_creator_idx" ON public.launchpads USING btree ("chainId", creator);
CREATE UNIQUE INDEX "launchpads_contractAddress_key" ON public.launchpads USING btree ("contractAddress");
CREATE INDEX "launchpads_createdAt_idx" ON public.launchpads USING btree ("createdAt");
CREATE INDEX launchpads_creator_idx ON public.launchpads USING btree (creator);
CREATE INDEX launchpads_creator_lower_idx ON public.launchpads USING btree (lower(creator));
CREATE INDEX "launchpads_isFeatured_idx" ON public.launchpads USING btree ("isFeatured");

-- Table Triggers

create trigger prevent_manual_minted_count_update_trigger before
update
    on
    public.launchpads for each row
    when ((old."mintedCount" is distinct
from
    new."mintedCount")) execute function prevent_manual_minted_count_update();


-- public.marketplace_offers definition

-- Drop table

-- DROP TABLE public.marketplace_offers;

CREATE TABLE public.marketplace_offers (
	id text NOT NULL,
	"chainId" int4 NOT NULL,
	marketplace public."Marketplace" NOT NULL,
	"contractAddress" text NOT NULL,
	"tokenId" text NOT NULL,
	offerer text NOT NULL,
	price text NOT NULL,
	currency text NOT NULL,
	quantity text NOT NULL DEFAULT '1'::text,
	"offerTime" timestamp(3) NOT NULL,
	"expirationTime" timestamp(3) NULL,
	status public."OfferStatus" NOT NULL,
	"offerTxHash" text NOT NULL,
	"offerBlock" int4 NOT NULL,
	"acceptTxHash" text NULL,
	"acceptBlock" int4 NULL,
	"cancelTxHash" text NULL,
	"cancelBlock" int4 NULL,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3) NOT NULL,
	CONSTRAINT marketplace_offers_pkey PRIMARY KEY (id),
	CONSTRAINT "marketplace_offers_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES public.chains("chainId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "marketplace_offers_chainId_marketplace_status_idx" ON public.marketplace_offers USING btree ("chainId", marketplace, status);
CREATE INDEX "marketplace_offers_contractAddress_tokenId_idx" ON public.marketplace_offers USING btree ("contractAddress", "tokenId");
CREATE INDEX marketplace_offers_offerer_idx ON public.marketplace_offers USING btree (offerer);


-- public.nft_contracts definition

-- Drop table

-- DROP TABLE public.nft_contracts;

CREATE TABLE public.nft_contracts (
	id text NOT NULL,
	"chainId" int4 NOT NULL,
	address text NOT NULL,
	name text NULL,
	symbol text NULL,
	"totalSupply" text NULL,
	"tokenType" text NULL,
	"contractDeployer" text NULL,
	"deployedBlockNumber" int4 NULL,
	"openSeaFloorPrice" float8 NULL,
	"openSeaCollectionName" text NULL,
	"openSeaCollectionSlug" text NULL,
	"openSeaSafelistStatus" text NULL,
	"openSeaImageUrl" text NULL,
	"openSeaDescription" text NULL,
	"openSeaExternalUrl" text NULL,
	"openSeaTwitter" text NULL,
	"openSeaDiscord" text NULL,
	"openSeaBannerImageUrl" text NULL,
	"openSeaLastIngestedAt" timestamp(3) NULL,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3) NOT NULL,
	CONSTRAINT nft_contracts_pkey PRIMARY KEY (id),
	CONSTRAINT "nft_contracts_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES public.chains("chainId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "nft_contracts_address_chainId_key" ON public.nft_contracts USING btree (address, "chainId");
CREATE INDEX "nft_contracts_chainId_idx" ON public.nft_contracts USING btree ("chainId");


-- public.nft_floor_prices definition

-- Drop table

-- DROP TABLE public.nft_floor_prices;

CREATE TABLE public.nft_floor_prices (
	id text NOT NULL,
	"chainId" int4 NOT NULL,
	"contractAddress" text NOT NULL,
	marketplace public."Marketplace" NOT NULL,
	"floorPrice" float8 NOT NULL,
	"priceCurrency" text NOT NULL,
	"collectionUrl" text NULL,
	"retrievedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT nft_floor_prices_pkey PRIMARY KEY (id),
	CONSTRAINT "nft_floor_prices_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES public.chains("chainId") ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT "nft_floor_prices_contractAddress_chainId_fkey" FOREIGN KEY ("contractAddress","chainId") REFERENCES public.nft_contracts(address,"chainId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "nft_floor_prices_contractAddress_chainId_marketplace_idx" ON public.nft_floor_prices USING btree ("contractAddress", "chainId", marketplace);
CREATE INDEX "nft_floor_prices_retrievedAt_idx" ON public.nft_floor_prices USING btree ("retrievedAt");


-- public.nfts definition

-- Drop table

-- DROP TABLE public.nfts;

CREATE TABLE public.nfts (
	id text NOT NULL,
	"chainId" int4 NOT NULL,
	"contractAddress" text NOT NULL,
	"tokenId" text NOT NULL,
	"tokenType" text NOT NULL,
	name text NULL,
	description text NULL,
	"tokenUri" text NULL,
	"imageCachedUrl" text NULL,
	"imageThumbnailUrl" text NULL,
	"imagePngUrl" text NULL,
	"imageContentType" text NULL,
	"imageSize" int4 NULL,
	"imageOriginalUrl" text NULL,
	"rawMetadata" jsonb NULL,
	"rawTokenUri" text NULL,
	"timeLastUpdated" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"acquiredBlockTimestamp" timestamp(3) NULL,
	"acquiredBlockNumber" int4 NULL,
	"mintAddress" text NULL,
	"mintBlockNumber" int4 NULL,
	"mintTimestamp" timestamp(3) NULL,
	"mintTransactionHash" text NULL,
	"isSpam" bool NOT NULL DEFAULT false,
	"isAirdrop" bool NOT NULL DEFAULT false,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3) NOT NULL,
	CONSTRAINT nfts_pkey PRIMARY KEY (id),
	CONSTRAINT "nfts_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES public.chains("chainId") ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT "nfts_contractAddress_chainId_fkey" FOREIGN KEY ("contractAddress","chainId") REFERENCES public.nft_contracts(address,"chainId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "nfts_chainId_contractAddress_idx" ON public.nfts USING btree ("chainId", "contractAddress");
CREATE UNIQUE INDEX "nfts_contractAddress_tokenId_chainId_key" ON public.nfts USING btree ("contractAddress", "tokenId", "chainId");
CREATE INDEX "nfts_isSpam_isAirdrop_idx" ON public.nfts USING btree ("isSpam", "isAirdrop");


-- public.activities definition

-- Drop table

-- DROP TABLE public.activities;

CREATE TABLE public.activities (
	id text NOT NULL,
	"chainId" int4 NOT NULL,
	"factoryId" text NULL,
	"launchpadId" text NULL,
	"type" public."ActivityType" NOT NULL,
	actor text NOT NULL,
	description text NOT NULL,
	"txHash" text NULL,
	"blockNumber" int4 NULL,
	metadata jsonb NULL,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT activities_pkey PRIMARY KEY (id),
	CONSTRAINT "activities_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES public.chains("chainId") ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT "activities_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES public.launchpad_factories(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "activities_chainId_type_createdAt_idx" ON public.activities USING btree ("chainId", type, "createdAt" DESC);
CREATE INDEX "activities_createdAt_idx" ON public.activities USING btree ("createdAt" DESC);
CREATE INDEX "activities_txHash_type_launchpadId_idx" ON public.activities USING btree ("txHash", type, "launchpadId");


-- public.banners definition

-- Drop table

-- DROP TABLE public.banners;

CREATE TABLE public.banners (
	id text NOT NULL,
	title text NOT NULL,
	creator text NOT NULL,
	network text NOT NULL DEFAULT 'evm'::text,
	image text NOT NULL,
	thumbnail text NULL,
	"type" public."BannerType" NOT NULL DEFAULT 'IMAGE'::"BannerType",
	twitter text NULL,
	discord text NULL,
	telegram text NULL,
	"collectionAddress" text NULL,
	"launchpadId" text NULL,
	"mintedDate" timestamp(3) NULL,
	"mintedLink" text NULL,
	status public."BannerStatus" NOT NULL DEFAULT 'ACTIVE'::"BannerStatus",
	"sequence" int4 NOT NULL DEFAULT 0,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3) NOT NULL,
	"endDate" timestamp(3) NULL,
	"promoCode" text NULL,
	"startDate" timestamp(3) NULL,
	CONSTRAINT banners_pkey PRIMARY KEY (id),
	CONSTRAINT "banners_launchpadId_fkey" FOREIGN KEY ("launchpadId") REFERENCES public.launchpads(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "banners_promoCode_key" ON public.banners USING btree ("promoCode");
CREATE INDEX "banners_startDate_endDate_idx" ON public.banners USING btree ("startDate", "endDate");
CREATE INDEX banners_status_sequence_idx ON public.banners USING btree (status, sequence);


-- public.factory_settings definition

-- Drop table

-- DROP TABLE public.factory_settings;

CREATE TABLE public.factory_settings (
	id text NOT NULL,
	"factoryId" text NOT NULL,
	"key" text NOT NULL,
	value text NOT NULL,
	"type" public."SettingType" NOT NULL DEFAULT 'STRING'::"SettingType",
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3) NOT NULL,
	CONSTRAINT factory_settings_pkey PRIMARY KEY (id),
	CONSTRAINT "factory_settings_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES public.launchpad_factories(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "factory_settings_factoryId_key_key" ON public.factory_settings USING btree ("factoryId", key);


-- public.launchpad_analytics definition

-- Drop table

-- DROP TABLE public.launchpad_analytics;

CREATE TABLE public.launchpad_analytics (
	id text NOT NULL,
	"launchpadId" text NOT NULL,
	"totalVolume" text NOT NULL DEFAULT '0'::text,
	"totalMints" int4 NOT NULL DEFAULT 0,
	"uniqueHolders" int4 NOT NULL DEFAULT 0,
	"avgMintPrice" text NOT NULL DEFAULT '0'::text,
	"floorPrice" text NULL,
	"lastSalePrice" text NULL,
	"views" int4 NOT NULL DEFAULT 0,
	likes int4 NOT NULL DEFAULT 0,
	"calculatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3) NOT NULL,
	CONSTRAINT launchpad_analytics_pkey PRIMARY KEY (id),
	CONSTRAINT "launchpad_analytics_launchpadId_fkey" FOREIGN KEY ("launchpadId") REFERENCES public.launchpads(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "launchpad_analytics_launchpadId_key" ON public.launchpad_analytics USING btree ("launchpadId");


-- public.launchpad_metadata definition

-- Drop table

-- DROP TABLE public.launchpad_metadata;

CREATE TABLE public.launchpad_metadata (
	id text NOT NULL,
	"launchpadId" text NOT NULL,
	image text NULL,
	"bannerImage" text NULL,
	website text NULL,
	twitter text NULL,
	discord text NULL,
	telegram text NULL,
	medium text NULL,
	github text NULL,
	tags _text NULL,
	category text NULL,
	featured bool NOT NULL DEFAULT false,
	verified bool NOT NULL DEFAULT false,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3) NOT NULL,
	CONSTRAINT launchpad_metadata_pkey PRIMARY KEY (id),
	CONSTRAINT "launchpad_metadata_launchpadId_fkey" FOREIGN KEY ("launchpadId") REFERENCES public.launchpads(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "launchpad_metadata_launchpadId_key" ON public.launchpad_metadata USING btree ("launchpadId");


-- public.launchpad_phases definition

-- Drop table

-- DROP TABLE public.launchpad_phases;

CREATE TABLE public.launchpad_phases (
	id text NOT NULL,
	"launchpadId" text NOT NULL,
	name text NOT NULL,
	"phaseType" public."PhaseType" NOT NULL,
	"startTime" timestamp(3) NOT NULL,
	"endTime" timestamp(3) NULL,
	price text NOT NULL,
	"maxMintPerWallet" int4 NULL,
	"totalLimit" int4 NULL,
	"mintedCount" int4 NOT NULL DEFAULT 0,
	"isActive" bool NOT NULL DEFAULT true,
	"merkleRoot" text NULL,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3) NOT NULL,
	"phaseIndex" int4 NOT NULL,
	CONSTRAINT "launchpad_phases_launchpadId_phaseIndex_key" UNIQUE ("launchpadId", "phaseIndex"),
	CONSTRAINT launchpad_phases_pkey PRIMARY KEY (id),
	CONSTRAINT "launchpad_phases_launchpadId_fkey" FOREIGN KEY ("launchpadId") REFERENCES public.launchpads(id) ON DELETE CASCADE ON UPDATE CASCADE
);


-- public.launchpad_whitelists definition

-- Drop table

-- DROP TABLE public.launchpad_whitelists;

CREATE TABLE public.launchpad_whitelists (
	id text NOT NULL,
	"launchpadId" text NOT NULL,
	"phaseId" int4 NOT NULL,
	address text NOT NULL,
	allocation int4 NOT NULL DEFAULT 1,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3) NOT NULL,
	CONSTRAINT launchpad_whitelists_pkey PRIMARY KEY (id),
	CONSTRAINT "launchpad_whitelists_launchpadId_fkey" FOREIGN KEY ("launchpadId") REFERENCES public.launchpads(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "launchpad_whitelists_launchpadId_phaseId_address_key" ON public.launchpad_whitelists USING btree ("launchpadId", "phaseId", address);
CREATE INDEX "launchpad_whitelists_launchpadId_phaseId_idx" ON public.launchpad_whitelists USING btree ("launchpadId", "phaseId");


-- public.marketplace_listings definition

-- Drop table

-- DROP TABLE public.marketplace_listings;

CREATE TABLE public.marketplace_listings (
	id text NOT NULL,
	"chainId" int4 NOT NULL,
	marketplace public."Marketplace" NOT NULL,
	"contractAddress" text NOT NULL,
	"tokenId" text NOT NULL,
	seller text NOT NULL,
	price text NOT NULL,
	currency text NOT NULL,
	quantity text NOT NULL DEFAULT '1'::text,
	"startTime" timestamp(3) NOT NULL,
	"endTime" timestamp(3) NULL,
	"expirationTime" timestamp(3) NULL,
	status public."ListingStatus" NOT NULL,
	"listingTxHash" text NOT NULL,
	"listingBlock" int4 NOT NULL,
	"cancelTxHash" text NULL,
	"cancelBlock" int4 NULL,
	"saleTxHash" text NULL,
	"saleBlock" int4 NULL,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3) NOT NULL,
	CONSTRAINT marketplace_listings_pkey PRIMARY KEY (id),
	CONSTRAINT "marketplace_listings_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES public.chains("chainId") ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT "marketplace_listings_contractAddress_chainId_fkey" FOREIGN KEY ("contractAddress","chainId") REFERENCES public.nft_contracts(address,"chainId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "marketplace_listings_chainId_marketplace_status_idx" ON public.marketplace_listings USING btree ("chainId", marketplace, status);
CREATE INDEX "marketplace_listings_contractAddress_tokenId_idx" ON public.marketplace_listings USING btree ("contractAddress", "tokenId");
CREATE INDEX marketplace_listings_seller_idx ON public.marketplace_listings USING btree (seller);


-- public.marketplace_sales definition

-- Drop table

-- DROP TABLE public.marketplace_sales;

CREATE TABLE public.marketplace_sales (
	id text NOT NULL,
	"chainId" int4 NOT NULL,
	marketplace public."Marketplace" NOT NULL,
	"contractAddress" text NOT NULL,
	"tokenId" text NOT NULL,
	buyer text NOT NULL,
	seller text NOT NULL,
	price text NOT NULL,
	currency text NOT NULL,
	quantity text NOT NULL DEFAULT '1'::text,
	"sellerFeeAmount" text NULL,
	"sellerFeeCurrency" text NULL,
	"protocolFeeAmount" text NULL,
	"protocolFeeCurrency" text NULL,
	"royaltyFeeAmount" text NULL,
	"royaltyFeeCurrency" text NULL,
	"txHash" text NOT NULL,
	"blockNumber" int4 NOT NULL,
	"blockTimestamp" timestamp(3) NOT NULL,
	"logIndex" int4 NOT NULL,
	"bundleIndex" int4 NOT NULL DEFAULT 0,
	taker text NOT NULL,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"listingId" text NULL,
	CONSTRAINT marketplace_sales_pkey PRIMARY KEY (id),
	CONSTRAINT "marketplace_sales_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES public.chains("chainId") ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT "marketplace_sales_contractAddress_chainId_fkey" FOREIGN KEY ("contractAddress","chainId") REFERENCES public.nft_contracts(address,"chainId") ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT "marketplace_sales_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES public.marketplace_listings(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "marketplace_sales_blockNumber_idx" ON public.marketplace_sales USING btree ("blockNumber");
CREATE INDEX marketplace_sales_buyer_idx ON public.marketplace_sales USING btree (buyer);
CREATE INDEX "marketplace_sales_chainId_marketplace_idx" ON public.marketplace_sales USING btree ("chainId", marketplace);
CREATE INDEX "marketplace_sales_contractAddress_tokenId_idx" ON public.marketplace_sales USING btree ("contractAddress", "tokenId");
CREATE UNIQUE INDEX "marketplace_sales_listingId_key" ON public.marketplace_sales USING btree ("listingId");
CREATE INDEX marketplace_sales_seller_idx ON public.marketplace_sales USING btree (seller);
CREATE UNIQUE INDEX "marketplace_sales_txHash_logIndex_bundleIndex_key" ON public.marketplace_sales USING btree ("txHash", "logIndex", "bundleIndex");


-- public.mints definition

-- Drop table

-- DROP TABLE public.mints;

CREATE TABLE public.mints (
	id text NOT NULL,
	"launchpadId" text NOT NULL,
	"phaseId" text NULL,
	minter text NOT NULL,
	"tokenId" int4 NULL,
	quantity int4 NOT NULL DEFAULT 1,
	price text NOT NULL,
	"txHash" text NOT NULL,
	"blockNumber" int4 NULL,
	"gasUsed" text NULL,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT mints_pkey PRIMARY KEY (id),
	CONSTRAINT "mints_launchpadId_fkey" FOREIGN KEY ("launchpadId") REFERENCES public.launchpads(id) ON DELETE CASCADE ON UPDATE CASCADE,
	CONSTRAINT "mints_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES public.launchpad_phases(id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- Table Triggers

create trigger mint_insert_trigger after
insert
    on
    public.mints for each row execute function update_minted_count_on_mint_insert();
create trigger mint_delete_trigger after
delete
    on
    public.mints for each row execute function update_minted_count_on_mint_delete();


-- public.nft_attributes definition

-- Drop table

-- DROP TABLE public.nft_attributes;

CREATE TABLE public.nft_attributes (
	id text NOT NULL,
	"nftId" text NOT NULL,
	"traitType" text NOT NULL,
	value text NOT NULL,
	"displayType" text NULL,
	"numericValue" float8 NULL,
	prevalence float8 NULL,
	count int4 NULL,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3) NOT NULL,
	CONSTRAINT nft_attributes_pkey PRIMARY KEY (id),
	CONSTRAINT "nft_attributes_nftId_fkey" FOREIGN KEY ("nftId") REFERENCES public.nfts(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "nft_attributes_nftId_idx" ON public.nft_attributes USING btree ("nftId");
CREATE INDEX "nft_attributes_traitType_value_idx" ON public.nft_attributes USING btree ("traitType", value);


-- public.nft_collection_analytics definition

-- Drop table

-- DROP TABLE public.nft_collection_analytics;

CREATE TABLE public.nft_collection_analytics (
	id text NOT NULL,
	"chainId" int4 NOT NULL,
	"contractAddress" text NOT NULL,
	"totalVolume" text NOT NULL DEFAULT '0'::text,
	volume24h text NOT NULL DEFAULT '0'::text,
	volume7d text NOT NULL DEFAULT '0'::text,
	volume30d text NOT NULL DEFAULT '0'::text,
	"totalSales" int4 NOT NULL DEFAULT 0,
	sales24h int4 NOT NULL DEFAULT 0,
	sales7d int4 NOT NULL DEFAULT 0,
	sales30d int4 NOT NULL DEFAULT 0,
	"floorPrice" text NULL,
	"avgSalePrice" text NOT NULL DEFAULT '0'::text,
	"lastSalePrice" text NULL,
	"highestSale" text NULL,
	"uniqueHolders" int4 NOT NULL DEFAULT 0,
	"totalSupply" int4 NOT NULL DEFAULT 0,
	"calculatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3) NOT NULL,
	CONSTRAINT nft_collection_analytics_pkey PRIMARY KEY (id),
	CONSTRAINT "nft_collection_analytics_contractAddress_chainId_fkey" FOREIGN KEY ("contractAddress","chainId") REFERENCES public.nft_contracts(address,"chainId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "nft_collection_analytics_contractAddress_chainId_key" ON public.nft_collection_analytics USING btree ("contractAddress", "chainId");


-- public.nft_ownership definition

-- Drop table

-- DROP TABLE public.nft_ownership;

CREATE TABLE public.nft_ownership (
	id text NOT NULL,
	"nftId" text NOT NULL,
	"ownerAddress" text NOT NULL,
	balance text NOT NULL DEFAULT '1'::text,
	"acquiredAt" timestamp(3) NOT NULL,
	"acquiredBlock" int4 NOT NULL,
	"acquiredTxHash" text NOT NULL,
	"isCurrent" bool NOT NULL DEFAULT true,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3) NOT NULL,
	CONSTRAINT nft_ownership_pkey PRIMARY KEY (id),
	CONSTRAINT "nft_ownership_nftId_fkey" FOREIGN KEY ("nftId") REFERENCES public.nfts(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "nft_ownership_nftId_isCurrent_idx" ON public.nft_ownership USING btree ("nftId", "isCurrent");
CREATE INDEX "nft_ownership_ownerAddress_isCurrent_idx" ON public.nft_ownership USING btree ("ownerAddress", "isCurrent");


-- public.nft_rarity definition

-- Drop table

-- DROP TABLE public.nft_rarity;

CREATE TABLE public.nft_rarity (
	id text NOT NULL,
	"nftId" text NOT NULL,
	"strategyId" text NOT NULL,
	"strategyVersion" text NOT NULL,
	"rank" int4 NOT NULL,
	score float8 NOT NULL,
	"maxRank" int4 NOT NULL,
	"totalSupply" int4 NOT NULL,
	"rarityScore" float8 NOT NULL,
	prevalence float8 NOT NULL,
	percentile float8 NOT NULL,
	"calculatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3) NOT NULL,
	CONSTRAINT nft_rarity_pkey PRIMARY KEY (id),
	CONSTRAINT "nft_rarity_nftId_fkey" FOREIGN KEY ("nftId") REFERENCES public.nfts(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "nft_rarity_nftId_key" ON public.nft_rarity USING btree ("nftId");
CREATE INDEX nft_rarity_rank_idx ON public.nft_rarity USING btree (rank);


-- public.nft_transfers definition

-- Drop table

-- DROP TABLE public.nft_transfers;

CREATE TABLE public.nft_transfers (
	id text NOT NULL,
	"chainId" int4 NOT NULL,
	"nftId" text NOT NULL,
	"fromAddress" text NOT NULL,
	"toAddress" text NOT NULL,
	quantity text NOT NULL DEFAULT '1'::text,
	"txHash" text NOT NULL,
	"blockNumber" int4 NOT NULL,
	"blockTimestamp" timestamp(3) NOT NULL,
	"logIndex" int4 NOT NULL,
	"transferType" public."TransferType" NOT NULL,
	"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT nft_transfers_pkey PRIMARY KEY (id),
	CONSTRAINT "nft_transfers_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES public.chains("chainId") ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT "nft_transfers_nftId_fkey" FOREIGN KEY ("nftId") REFERENCES public.nfts(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "nft_transfers_blockNumber_idx" ON public.nft_transfers USING btree ("blockNumber");
CREATE INDEX "nft_transfers_fromAddress_idx" ON public.nft_transfers USING btree ("fromAddress");
CREATE INDEX "nft_transfers_nftId_idx" ON public.nft_transfers USING btree ("nftId");
CREATE INDEX "nft_transfers_toAddress_idx" ON public.nft_transfers USING btree ("toAddress");
CREATE UNIQUE INDEX "nft_transfers_txHash_logIndex_key" ON public.nft_transfers USING btree ("txHash", "logIndex");