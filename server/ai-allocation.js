const aiAllocationModule = import('../shared/ai-allocation.mjs');

const suggestAllocation = async (options) => {
  const { suggestAllocation: suggest } = await aiAllocationModule;
  return suggest(options);
};

module.exports = { suggestAllocation };
