const config = require('config');
const categories = require('../filters/filters-categories');
const log = require('../utils/log');

/**
 * Rules groups for multi content blockers
 *
 * @type {{updateContentBlocker}}
 */
module.exports = (function () {
    const AFFINITY_DIRECTIVE = '!#safari_cb_affinity';
    const AFFINITY_DIRECTIVE_START = '!#safari_cb_affinity(';

    const AntiBannerFilterGroupsId = config.get('AntiBannerFilterGroupsId');
    const AntiBannerFiltersId = config.get('AntiBannerFiltersId');

    const SafariExtensionBundles = config.get('SafariExtensionBundles');

    /**
     * Rules groups
     *
     * @type {{*}}
     */
    const groups = {
        general: {
            key: 'general',
            filterGroups: [AntiBannerFilterGroupsId.AD_BLOCKING_ID, AntiBannerFilterGroupsId.LANGUAGE_SPECIFIC_ID],
        },
        privacy: {
            key: 'privacy',
            filterGroups: [AntiBannerFilterGroupsId.PRIVACY_ID],
        },
        security: {
            key: 'security',
            filterGroups: [AntiBannerFilterGroupsId.SECURITY_ID],
        },
        socialWidgetsAndAnnoyances: {
            key: 'socialWidgetsAndAnnoyances',
            filterGroups: [AntiBannerFilterGroupsId.SOCIAL_ID, AntiBannerFilterGroupsId.ANNOYANCES_ID],
        },
        other: {
            key: 'other',
            filterGroups: [AntiBannerFilterGroupsId.OTHER_ID],
        },
        custom: {
            key: 'custom',
            filterGroups: [AntiBannerFilterGroupsId.CUSTOM_FILTERS_GROUP_ID],
        },
    };

    /**
     * Affinity blocks
     *
     * @type {{*}}
     */
    const groupsByAffinity = {
        general: [groups.general],
        privacy: [groups.privacy],
        security: [groups.security],
        social: [groups.socialWidgetsAndAnnoyances],
        other: [groups.other],
        custom: [groups.custom],
        all: [
            groups.general,
            groups.privacy,
            groups.security,
            groups.socialWidgetsAndAnnoyances,
            groups.other,
            groups.custom,
        ],
    };

    /**
     * Rules groups to extension bundle identifiers dictionary
     */
    const rulesGroupsBundles = {
        general: SafariExtensionBundles.GENERAL,
        privacy: SafariExtensionBundles.PRIVACY,
        socialWidgetsAndAnnoyances: SafariExtensionBundles.SOCIAL_WIDGETS_AND_ANNOYANCES,
        security: SafariExtensionBundles.SECURITY,
        other: SafariExtensionBundles.OTHER,
        custom: SafariExtensionBundles.CUSTOM,
    };

    /**
     * Groups provided rules
     *
     * @param rules
     * @return {[*]}
     */
    const groupRules = (rules) => {
        const rulesByFilterId = {};
        rules.forEach((x) => {
            if (!rulesByFilterId[x.filterId]) {
                rulesByFilterId[x.filterId] = [];
            }

            rulesByFilterId[x.filterId].push(x);
        });

        const rulesByGroup = {};
        const rulesByAffinityBlocks = {};

        for (const key in groups) {
            const group = groups[key];
            const groupRules = [];

            for (const filterGroupId of group.filterGroups) {
                const filters = categories.getFiltersByGroupId(filterGroupId);
                for (const f of filters) {
                    const filterRules = rulesByFilterId[f.filterId];
                    sortWithAffinityBlocks(filterRules, groupRules, rulesByAffinityBlocks);
                }
            }

            const userFilterRules = rulesByFilterId[AntiBannerFiltersId.USER_FILTER_ID];
            sortWithAffinityBlocks(userFilterRules, groupRules, rulesByAffinityBlocks);

            rulesByGroup[key] = groupRules;
        }

        const result = [];
        for (const groupName in groups) {
            const { key } = groups[groupName];
            const { filterGroups } = groups[groupName];

            if (rulesByAffinityBlocks[key]) {
                log.debug(`Group rules for ${key} length: ${rulesByGroup[key].length}`);
                log.debug(`Affinity rules for ${key} length: ${rulesByAffinityBlocks[key].length}`);
                rulesByGroup[key] = rulesByGroup[key].concat(rulesByAffinityBlocks[key]);
            }

            // Remove duplicates
            const uniqueRules = Object.create(null);
            const optimized = [];
            for (const x of rulesByGroup[key]) {
                if (!x || (x.ruleText in uniqueRules)) {
                    // Do not allow duplicates
                    continue;
                }
                uniqueRules[x.ruleText] = true;
                optimized.push(x);
            }
            rulesByGroup[key] = optimized;

            result.push({
                key,
                rules: rulesByGroup[key],
                filterGroups,
            });

            log.info(`Affinity block ${key}: rules length: ${rulesByGroup[key].length}`);
        }

        return result;
    };

    /**
     * Selects affinity blocks from rules
     *
     * @param filterRules
     * @param groupRules
     * @param rulesByAffinityBlocks
     */
    const sortWithAffinityBlocks = (filterRules, groupRules, rulesByAffinityBlocks) => {
        if (!filterRules) {
            return;
        }

        let currentBlockGroups = [];

        for (const rule of filterRules) {
            const { ruleText } = rule;

            if (!ruleText) {
                continue;
            }

            if (ruleText.startsWith(AFFINITY_DIRECTIVE_START)) {
                currentBlockGroups = parseGroupsByAffinity(ruleText);
            } else if (ruleText.startsWith(AFFINITY_DIRECTIVE)) {
                currentBlockGroups = [];
            } else if (currentBlockGroups.length > 0) {
                for (const group of currentBlockGroups) {
                    if (!rulesByAffinityBlocks[group.key]) {
                        rulesByAffinityBlocks[group.key] = [];
                    }

                    log.debug(`Rule ${ruleText} sorted to ${group.key}`);
                    rulesByAffinityBlocks[group.key].push(rule);
                }
            } else {
                groupRules.push(rule);
            }
        }
    };

    /**
     * Parses groups from affinity directive
     *
     * @param ruleText
     * @return {Array}
     */
    const parseGroupsByAffinity = (ruleText) => {
        let result = [];

        const startIndex = AFFINITY_DIRECTIVE.length + 1;
        const stripped = ruleText.substring(startIndex, ruleText.length - 1);
        const list = stripped.split(',');
        for (const affinityBlock of list) {
            const block = affinityBlock.trim();
            const affinityGroups = groupsByAffinity[block];
            if (affinityGroups && affinityGroups.length > 0) {
                result = result.concat(affinityGroups);
            }
        }

        return result;
    };

    let bundleGroups;
    const filterGroupsBundles = () => {
        if (bundleGroups) {
            return bundleGroups;
        }

        const result = [];

        for (const key in rulesGroupsBundles) {
            if (groups[key]) {
                result.push({
                    bundleId: rulesGroupsBundles[key],
                    groupIds: groups[key].filterGroups,
                });
            }
        }

        bundleGroups = result;
        return result;
    };

    return {
        groupRules,
        groups,
        rulesGroupsBundles,
        filterGroupsBundles,
    };
})();
