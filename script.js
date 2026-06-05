document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const dataFileInput = document.getElementById('dataFile');
    const metaFileInput = document.getElementById('metaFile');
    const groupingVarSelect = document.getElementById('groupingVar');
    const featureVarSelect = document.getElementById('featureVar');
    const generateBtn = document.getElementById('generateBtn');
    const resultsSection = document.getElementById('resultsSection');
    const validationWarning = document.getElementById('validationWarning');
    const statsTableBody = document.querySelector('#statsTable tbody');
    const boxplotDiv = document.getElementById('boxplotDiv');
    const clearBtn = document.getElementById('clearBtn');
    const formatToggle = document.getElementById('formatToggle');

    // State Variables
    let parsedData = null; // Holds rows from data TSV
    let parsedMeta = null; // Holds rows from metadata TSV
    let dataHeaders = [];  // Sample IDs (and feature column name)
    let metaDataMap = {};  // Maps sample-id to metadata object
    let featureColName = '';

    // File Upload Listeners
    dataFileInput.addEventListener('change', (e) => handleFileUpload(e, 'data'));
    metaFileInput.addEventListener('change', (e) => handleFileUpload(e, 'meta'));
    clearBtn.addEventListener('click', resetApplication);
    formatToggle.addEventListener('change', () => {
        // Only re-process if a file is already loaded
        if (dataFileInput.files.length > 0) {
            // Re-trigger the file parsing logic
            handleFileUpload({ target: { files: [dataFileInput.files[0]] } }, 'data');
        }
    });

    /**
     * Refactored handleFileUpload to be cleaner
     * (Ensure this function uses the currently selected radio value)
     */
    function handleFileUpload(event, type) {
        const file = event.target.files[0];
        const isFeaturePerRow = document.querySelector('input[name="dataFormat"]:checked').value === 'feature-row';

        Papa.parse(file, {
            header: true,
            delimiter: "\t",
            skipEmptyLines: true,
            complete: function(results) {
                if (type === 'data') {
                    let data = results.data;
                    // If switching to "Sample as Row", transpose the data
                    parsedData = isFeaturePerRow ? data : transposeData(data);
                    dataHeaders = Object.keys(parsedData[0]);
                    featureColName = dataHeaders[0]; 
                    
                    populateFeatureDropdown();
                } else if (type === 'meta') {
                    parsedMeta = results.data;
                    processMetadata(results.meta.fields);
                }
                checkReadyState();
            }
        });
    }

    // Helper function to turn Samples-as-Rows into Features-as-Rows
    function transposeData(data) {
        const samples = data.map(d => d[Object.keys(d)[0]]); // Get IDs from first column
        const features = Object.keys(data[0]).slice(1);
        
        return features.map(feature => {
            let row = { "feature-name": feature };
            data.forEach((d, i) => {
                row[samples[i]] = d[feature];
            });
            return row;
        });
    }

    function populateFeatureDropdown() {
        featureVarSelect.innerHTML = '';
        parsedData.forEach((row, index) => {
            const option = document.createElement('option');
            // Store index to easily retrieve the row later
            option.value = index; 
            option.textContent = row[featureColName];
            featureVarSelect.appendChild(option);
        });
        featureVarSelect.disabled = false;
    }

    function processMetadata(headers) {
        if (!headers.includes('sample-id')) {
            alert("Metadata file MUST contain a 'sample-id' column.");
            metaFileInput.value = '';
            return;
        }

        // Map meta data for quick lookup
        metaDataMap = {};
        parsedMeta.forEach(row => {
            metaDataMap[row['sample-id']] = row;
        });

        // Populate Grouping Dropdown (exclude sample-id)
        groupingVarSelect.innerHTML = '';
        headers.forEach(header => {
            if (header !== 'sample-id') {
                const option = document.createElement('option');
                option.value = header;
                option.textContent = header;
                groupingVarSelect.appendChild(option);
            }
        });
        groupingVarSelect.disabled = false;
    }

    function checkReadyState() {
        if (parsedData && parsedMeta) {
            generateBtn.disabled = false;
        }
    }

    // Generate Analysis
    generateBtn.addEventListener('click', async () => {
        validationWarning.classList.add('hidden');
        validationWarning.innerHTML = '';
        
        const selectedFeatureIndex = featureVarSelect.value;
        const selectedGroupVar = groupingVarSelect.value;
        const featureRow = parsedData[selectedFeatureIndex];
        const featureName = featureRow[featureColName];

        // 1. Map Data and Validate
        const sampleIds = dataHeaders.slice(1); // Exclude the feature name column
        const missingSamples = [];
        const nonNumericSamples = [];
        
        // Group data for calculations
        const groupedData = {};

        sampleIds.forEach(sampleId => {
            const val = parseFloat(featureRow[sampleId]);
            const metaInfo = metaDataMap[sampleId];

            if (!metaInfo) {
                missingSamples.push(sampleId);
                return;
            }

            if (isNaN(val)) {
                nonNumericSamples.push(sampleId);
                return;
            }

            const groupValue = metaInfo[selectedGroupVar] || 'Unknown';
            if (!groupedData[groupValue]) {
                groupedData[groupValue] = [];
            }
            groupedData[groupValue].push(val);
        });

        // Display Validation Warnings
        let warnings = [];
        if (missingSamples.length > 0) {
            warnings.push(`<strong>Missing Metadata:</strong> ${missingSamples.length} samples found in Data but not in Metadata 'sample-id'.`);
        }
        if (nonNumericSamples.length > 0) {
            warnings.push(`<strong>Non-Numeric Data:</strong> ${nonNumericSamples.length} samples contained non-numeric values for this feature and were skipped.`);
        }
        if (warnings.length > 0) {
            validationWarning.innerHTML = warnings.join('<br>');
            validationWarning.classList.remove('hidden');
        }

        // 2. Calculate Statistics & Prepare Plotly Data
        const plotData = [];
        statsTableBody.innerHTML = '';

        for (const [group, values] of Object.entries(groupedData)) {
            if (values.length === 0) continue;

            // Compute Stats
            const stats = calculateStatistics(values);

            // Populate Table
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${group}</td>
                <td>${values.length}</td>
                <td>${stats.min.toFixed(4)}</td>
                <td>${stats.max.toFixed(4)}</td>
                <td>${stats.mean.toFixed(4)}</td>
                <td>${stats.median.toFixed(4)}</td>
                <td>${stats.std.toFixed(4)}</td>
                <td>${stats.iqr.toFixed(4)}</td>
            `;
            statsTableBody.appendChild(tr);

            // Prepare Plotly Trace
            plotData.push({
                y: values,
                type: 'box',
                name: group,
                boxpoints: 'outliers',
                jitter: 0.3,
                pointpos: -1.8
            });
        }

        // 3. Render Visualization
        resultsSection.classList.remove('hidden');
        Plotly.newPlot(boxplotDiv, plotData, {
            title: `Boxplot of ${featureName} grouped by ${selectedGroupVar}`,
            yaxis: { title: 'Value' },
            xaxis: { title: selectedGroupVar }
        });
    });

    // Math Helper Functions
    function calculateStatistics(arr) {
        const sorted = [...arr].sort((a, b) => a - b);
        const count = sorted.length;
        const sum = sorted.reduce((a, b) => a + b, 0);
        const mean = sum / count;
        
        const min = sorted[0];
        const max = sorted[count - 1];

        const mid = Math.floor(count / 2);
        const median = count % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

        const q1 = quantile(sorted, 0.25);
        const q3 = quantile(sorted, 0.75);
        const iqr = q3 - q1;

        const squaredDiffs = sorted.map(val => Math.pow(val - mean, 2));
        const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (count > 1 ? count - 1 : 1);
        const std = Math.sqrt(variance);

        return { min, max, mean, median, std, iqr };
    }

    function quantile(sortedArr, q) {
        const pos = (sortedArr.length - 1) * q;
        const base = Math.floor(pos);
        const rest = pos - base;
        if (sortedArr[base + 1] !== undefined) {
            return sortedArr[base] + rest * (sortedArr[base + 1] - sortedArr[base]);
        } else {
            return sortedArr[base];
        }
    }

    function resetApplication() {
        // 1. Reset State Variables
        parsedData = null;
        parsedMeta = null;
        dataHeaders = [];
        metaDataMap = {};
        featureColName = '';

        // 2. Clear File Inputs
        dataFileInput.value = '';
        metaFileInput.value = '';

        // 3. Reset Dropdowns
        groupingVarSelect.innerHTML = '<option value="">-- Upload metadata first --</option>';
        groupingVarSelect.disabled = true;
        featureVarSelect.innerHTML = '<option value="">-- Upload data first --</option>';
        featureVarSelect.disabled = true;

        // 4. Hide Results and Warnings
        resultsSection.classList.add('hidden');
        validationWarning.classList.add('hidden');
        
        // 5. Disable Generate Button
        generateBtn.disabled = true;

        // 6. Clear Plot and Table
        statsTableBody.innerHTML = '';
        boxplotDiv.innerHTML = '';
    }
});