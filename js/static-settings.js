export function assembleControlWorkspace(storedOverrides) {
  const tabsByIdentifier = new Map();
  const objectsByTab = new Map();

  return {
    getAssetUrl() {},
    sheet(tabIdentifier) {
      if (!tabsByIdentifier.has(tabIdentifier)) {
        tabsByIdentifier.set(tabIdentifier, {
          sequence: { position: 0, play() {}, pause() {} },
          object(entryIdentifier, starterData) {
            const entryData = combineData(starterData, storedOverrides[tabIdentifier]?.[entryIdentifier]);
            const listeners = new Set();
            const record = {
              address: { sheetId: tabIdentifier, objectKey: entryIdentifier },
              value: entryData,
              onValuesChange(changeListener) {
                listeners.add(changeListener);
                changeListener(entryData);
                return () => listeners.delete(changeListener);
              },
              apply(values) {
                mergeValues(entryData, values);
                for (const listener of listeners) listener(entryData);
              },
            };

            if (!objectsByTab.has(tabIdentifier)) objectsByTab.set(tabIdentifier, new Map());
            objectsByTab.get(tabIdentifier).set(entryIdentifier, record);
            return record;
          },
        });
      }
      return tabsByIdentifier.get(tabIdentifier);
    },
    applyTheme(themeValues) {
      mergeValues(storedOverrides, themeValues);
      for (const [tabIdentifier, objects] of Object.entries(themeValues)) {
        for (const [entryIdentifier, values] of Object.entries(objects)) {
          objectsByTab.get(tabIdentifier)?.get(entryIdentifier)?.apply(values);
        }
      }
    },
  };
}

function combineData(starterData, storedEntry) {
  if (storedEntry === undefined) return starterData;
  if (storedEntry === null || typeof storedEntry !== 'object') return storedEntry;
  const combinedData = { ...starterData };
  for (const entryIdentifier of Object.keys(storedEntry)) {
    combinedData[entryIdentifier] = combineData(starterData?.[entryIdentifier], storedEntry[entryIdentifier]);
  }
  return combinedData;
}

function mergeValues(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = mergeValues(target[key] || {}, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}
