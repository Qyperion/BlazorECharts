const CHANGE = 'change';
registerAction({ type: CHANGE, event: 'changed', update: 'update' }, () => {});
registers.registerAction('select', 'selected', function (payload) { return { selected: payload.name }; });
registers.registerAction(computeAction(), handler);
registerAction({ type: 'brushEnd', event: 'brushEnd' }, handler);
