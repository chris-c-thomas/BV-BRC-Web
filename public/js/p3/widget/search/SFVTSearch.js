define([
  'dojo/_base/declare', 'dojo/_base/lang', 'dojo/store/Memory', 'dojo/text!./templates/SFVTSearch.html', 'dojo/query',
  './TextInputEncoder', './SearchBase', './FacetStoreBuilder', './PathogenGroups', '../../util/PathJoin', 'dojo/request/xhr',
  'dijit/Dialog', 'dojo/on'
], function (
  declare, lang, Memory, template, query,
  TextInputEncoder, SearchBase, storeBuilder, pathogenGroupStore, PathJoin, xhr,
  Dialog, on
) {

  const influenzaSegmentMapping = {
    'PB2': '1',
    'PB1': '2',
    'PB1-F2': '2',
    'PA': '3',
    'HA': '4',
    'NP': '5',
    'NA': '6',
    'M1': '7',
    'M2': '7',
    'NS1': '8',
    'NS2': '8'
  };

  function sanitizeInput(str) {
    return str.replace(/\(|\)|\.|\*|\||\[|\]/g, '');
  }

  return declare([SearchBase], {
    templateString: template,
    searchAppName: 'Sequence Feature Variant Type (SFVT) Search',
    pageTitle: 'Sequence Feature Variant Type Search | BV-BRC',
    dataKey: 'genome_feature',
    resultUrlBase: '/view/Taxonomy/{taxon_id}?',
    resultUrlHash: '#view_tab=sfvt',
    defaultTaxonId: '11320',
    proteinOptions: ['12637'],
    segmentOptions: ['11320'],

    startup: function () {
      let sfvtSeqSearchButton = query('#sfvt-seq-search')[0];
      sfvtSeqSearchButton.info_dialog = new Dialog({
        content: '<section id="sfvt-seq-section" style="overflow-y: auto; max-height: 400px;">\n' +
          '<h2>SFVT Sequence</h2>\n' +
          '<p>Use this advanced search function to find Sequence Features (SFs) that match specific Sequence Feature Variant Type (SFVT) patterns.</p>\n' +
          '<br>\n' +
          '\n' +
          '<p><strong>Exact Match:</strong> Use "RER" to find sequences that are exactly "RER".</p>\n' +
          '<p><strong>Starts With:</strong> Use "RE*" to find sequences that start with "RE" and are followed by any characters (e.g., "REX", "REXY", "REXYZ").</p>\n' +
          '<p><strong>Ends With:</strong> Use "*RE" to find sequences that end with "RE" and are preceded by any characters.</p>\n' +
          '<p><strong>Includes:</strong> Enter "*RE*" to find sequences that contain "RE" anywhere within them.</p>\n' +
          '</section>',
        'class': 'helpModal',
        draggable: true,
        style: 'max-width: 400px;'
      });
      sfvtSeqSearchButton.open = false;
      on(sfvtSeqSearchButton, 'click', function () {
        if (!sfvtSeqSearchButton.open) {
          sfvtSeqSearchButton.open = true;
          sfvtSeqSearchButton.info_dialog.show();
        }
        else {
          sfvtSeqSearchButton.open = false;
          sfvtSeqSearchButton.info_dialog.hide();
        }
      });
    },

    postCreate: function () {
      this.inherited(arguments);

      storeBuilder('sequence_feature', 'taxon_id').then(lang.hitch(this, (store) => {
        // Display correct names based on taxon id
        for (let item of store.data) {
          const taxon = pathogenGroupStore.data.find(pathogen => pathogen.id == item.id);
          if (taxon) {
            item.name = taxon.name;
          }
        }
        this.pathogenGroupNode.store = store;
        if (this.defaultTaxonId) {
          this.pathogenGroupNode.set('value', this.defaultTaxonId);
        }
      }));

      storeBuilder('sequence_feature', 'sf_category').then(lang.hitch(this, (store) => {
        for (let item of store.data) {
          this.sequenceFeatureTypeNode.addOption(
            {
              value: item.name,
              label: item.name.charAt(0).toUpperCase() + item.name.slice(1)
            });
        }
      }));
    },

    onPathogenChange: function () {
      const taxonId = this.pathogenGroupNode.value;

      //Clear multi select values
      /*this.virusTypeNode.set('options', []);
      this.virusTypeNode.reset();*/
      this.subtypeNode.set('options', []);
      this.subtypeNode.reset();
      this.subtypeHNode.set('options', []);
      this.subtypeHNode.reset();
      this.subtypeNNode.set('options', []);
      this.subtypeNNode.reset();
      this.geneNode.set('options', []);
      this.geneNode.reset();

      //Update virus type multi select values with selected pathogen
      const condition = 'taxon_id:' + taxonId;
      storeBuilder('sequence_feature', 'subtype', condition).then(lang.hitch(this, (store) => {
        let hItems = [];
        let nItems = [];

        // Separate items based on their prefix
        for (let item of store.data) {
          if (item.name.startsWith('H')) {
            hItems.push({
              value: item.name,
              label: item.name.substring(1)
            });
          } else if (item.name.startsWith('N')) {
            nItems.push({
              value: item.name,
              label: item.name.substring(1)
            });
          } else {
            // Add other items to subtypeNode
            this.subtypeNode.addOption({
              value: item.name,
              label: item.name
            });
          }
        }

        // Sort 'H' and 'N' items numerically by their suffix
        hItems.sort((a, b) => parseInt(a.label) - parseInt(b.label));
        nItems.sort((a, b) => parseInt(a.label) - parseInt(b.label));

        // Add sorted 'H' and 'N' items to nodes
        this.subtypeHNode.addOption(hItems);
        this.subtypeNNode.addOption(nItems);
      }));

      storeBuilder('sequence_feature', 'gene', condition).then(lang.hitch(this, (store) => {
        let geneOptions = []
        for (let item of store.data) {
          const segmentNo = influenzaSegmentMapping[item.name];
          geneOptions.push(
            {
              value: item.name,
              label: segmentNo ? `${segmentNo} / ${item.name}` : item.name
            });
        }

        geneOptions.sort((a, b) => a.label.localeCompare(b.label));

        this.geneNode.addOption(geneOptions);
      }));

      if (this.segmentOptions.includes(taxonId)) {
        query('.proteinOptions').style('display', 'none');
        query('.segmentOptions').style('display', 'block');
      } else {
        query('.segmentOptions').style('display', 'none');
        query('.proteinOptions').style('display', 'block');
      }

      query('.sfvtOptions').style('display', 'block');
      query('#pathogenInfoDiv').style('display', 'none');
    },

    buildFilter: async function () {
      let filterArr = [];

      // Update taxon id to redirect correct taxonomy page
      const pathogenGroupValue = this.pathogenGroupNode.get('value');
      if (pathogenGroupValue !== '') {
        this.resultUrlBase = this.resultUrlBase.replace('{taxon_id}', pathogenGroupValue);
      }

      const keywordValue = this.keywordNode.get('value');
      if (keywordValue !== '') {
        filterArr.push(`keyword(${TextInputEncoder(sanitizeInput(keywordValue))})`);
      }

      /*const virusTypeValue = this.virusTypeNode.get('value');*/
      const subtypeValue = this.subtypeHNode.get('value')
        .concat(this.subtypeNNode.get('value'))
        .concat(this.subtypeNode.get('value'));
      if (subtypeValue.length === 1) {
        filterArr.push(`eq(subtype,"${sanitizeInput(subtypeValue[0])}")`);
      } else if (subtypeValue.length > 1) {
        filterArr.push(`or(${subtypeValue.map(v => `eq(subtype,"${sanitizeInput(v)}")`)})`);
      }

      const geneValue = this.geneNode.get('value');
      if (geneValue.length === 1) {
        filterArr.push(`eq(gene,"${sanitizeInput(geneValue[0])}")`);
      } else if (geneValue.length > 1) {
        filterArr.push(`or(${geneValue.map(v => `eq(gene,"${sanitizeInput(v)}")`)})`);
      }

      const sequenceFeatureTypeValue = this.sequenceFeatureTypeNode.get('value');
      if (sequenceFeatureTypeValue.length === 1) {
        filterArr.push(`eq(sf_category,"${sanitizeInput(sequenceFeatureTypeValue[0])}")`);
      } else if (sequenceFeatureTypeValue.length > 1) {
        filterArr.push(`or(${sequenceFeatureTypeValue.map(v => `eq(sf_category,"${sanitizeInput(v)}")`)})`);
      }

      /*const startValue = parseInt(this.aaCoordinatesStartNode.get('value'));
      if (!isNaN(startValue)) {
        // gt
        filterArr.push(`gt(start,${startValue})`);
      }

      const endValue = parseInt(this.aaCoordinatesEndNode.get('value'));
      if (!isNaN(endValue)) {
        // lt
        filterArr.push(`lt(end,${endValue})`);
      }*/

      /*const aaCoordinatesStartValue = parseInt(this.aaCoordinatesStartNode.get('value'));
      const aaCoordinatesEndValue = parseInt(this.aaCoordinatesEndNode.get('value'));
      if (!isNaN(aaCoordinatesStartValue) && !isNaN(aaCoordinatesEndValue)) {
        // between
        filterArr.push(`between(aa_coordinates,${aaCoordinatesStartValue},${aaCoordinatesEndValue})`);
      } else if (!isNaN(aaCoordinatesStartValue)) {
        // gt
        filterArr.push(`gt(aa_coordinates,${aaCoordinatesStartValue})`);
      } else if (!isNaN(aaCoordinatesEndValue)) {
        // lt
        filterArr.push(`lt(aa_coordinates,${aaCoordinatesEndValue})`);
      }*/

      // Fetch sf_id's if sfvt sequence is provided
      const sfvtSequenceValue = this.sfvtSequenceNode.get('value');
      if (sfvtSequenceValue !== '') {
        const query = '?in(sfvt_sequence,(' + sfvtSequenceValue + '))&select(sf_id)&limit(25000)';
        const sfvtList = await xhr.get(PathJoin(window.App.dataAPI, 'sequence_feature_vt', query), {
          headers: {
            accept: 'application/json',
            'Content-Type': 'application/rqlquery+x-www-form-urlencoded',
            'X-Requested-With': null,
            Authorization: (window.App.authorizationToken || '')
          },
          handleAs: 'json'
        });
        const uniqueSFIds = new Set(sfvtList.map(sfvt => sfvt.sf_id));
        filterArr.push(`or(${Array.from(uniqueSFIds).map(id => `eq(sf_id,"${sanitizeInput(id)}")`)})`);
      }

      if (filterArr.length === 1) {
        return filterArr;
      } else if (filterArr.length > 1) {
        return `and(${filterArr.join(',')})`;
      }
      return '';
    }
  });
});