/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/* globals PDFJS, FirefoxCom, Promise, scrollIntoView */

'use strict';

/**
 * Provides "reflow" view for tagged PDF.
 */
var PDFHTML5Controller = (function PDFHTML5ControllerClosure() {
  function PDFHTML5Controller(options) {
    this.pdfViewer = options.pdfViewer || null;
    //console.log('this.pdfViewer', this.pdfViewer);
    this.startedTextExtraction = false;
    this.pagesPromise = this.pdfViewer.pagesPromise;

    /*var events = [
      'find',
      'findagain',
      'findhighlightallchange',
      'findcasesensitivitychange'
    ];
    this.handleEvent = this.handleEvent.bind(this);

    for (var i = 0, len = events.length; i < len; i++) {
      window.addEventListener(events[i], this.handleEvent);
    }*/
  }

  PDFHTML5Controller.prototype = {
    extractText: function PDFHTML5Controller_extractText() {
      if (this.startedTextExtraction) {
        return;
      }
      this.startedTextExtraction = true;

      this.pageMarkedSequences = [];
      this.pageStructs = [];

      var self = this;
      function extractPageText(pageIndex) {
        self.pdfViewer.getPageTextContent(pageIndex).then(
          function textContentResolved(textContent) {
            var textItems = textContent.items;
            var markedSeqs = self.pageMarkedSequences[pageIndex] = {};
            self.pageStructs[pageIndex] = textContent.structs;
            var item, mcid;
            for (var i = 0, len = textItems.length; i < len; i++) {
              item = textItems[i];
              if (item && item.markedContent) {
                mcid = item.markedContent.MCID;
                if (!markedSeqs[mcid]) {
                  markedSeqs[mcid] = item.str;
                } else {
                  markedSeqs[mcid] += item.str;
                }
              }
            }

            if ((pageIndex + 1) < self.pdfViewer.pagesCount) {
              extractPageText(pageIndex + 1);
            } else {
              // all pages are ready, generate HTML output
              self.pdfViewer.pdfDocument.getStructTree().then(
                  function(structTree){
                if (!structTree) {
                  console.log('no structTree available');
                  return;
                }
                var roleMap = structTree.RoleMap;
                if(!('Part' in roleMap)){
                  roleMap.Part = 'section';
                }
                var children = structTree.children;
                var top = document.createElement('div');
                var queue = children.slice(0);
                var elements = {}, parent, current, seqs, elementname, elem;
                while(queue.length){
                  current = queue.pop();
                  parent = elements[current.parentpdfid] || top;
                  if (current.type === 'StructElem' ){
                    elementname = roleMap[current.name] || current.name;
                    if (elementname === 'Link') {
                      elementname = 'a';
                    } else if (elementname === 'Document') {
                      elementname = 'div';
                    }
                    elements[current.pdfid] = elem =
                      parent.insertBefore(document.createElement(elementname),
                                        parent.firstChild);
                    elem.setAttribute('pdfid', current.pdfid);
                    if (elementname === 'a' && current.uri) {
                      elem.setAttribute('href', current.uri);
                    }

                    if (current.children) {
                      queue = queue.concat(current.children);
                    }
                  } else if (current.type === 'MCR') {
                    //marked content sequence
                    seqs = self.pageMarkedSequences[current.page];
                    if (seqs && seqs[current.MCID]) {
                      elem = document.createElement('span');
                      elem.setAttribute('MCID', current.page + '/' + current.MCID);
                      elem.appendChild(document.createTextNode(seqs[current.MCID]));
                      parent.insertBefore(elem,
                                          parent.firstChild);
                    }
                  }
                }
                self._resolve(top.innerHTML);
                self.startedTextExtraction = false;
              });
            }
          }
        );
      }
      extractPageText(0);
      return new Promise(function (resolve) {
        self._resolve = resolve;
      });
    },

    handleEvent: function PDFHTML5Controller_handleEvent(e) {
      /*if (this.state === null || e.type !== 'findagain') {
        this.dirtyMatch = true;
      }
      this.state = e.detail;
      this.updateUIState(FindStates.FIND_PENDING);*/

      return this.pagesPromise.then(function() {
        return this.extractText();

        /*clearTimeout(this.findTimeout);
        if (e.type === 'find') {
          // Only trigger the find action after 250ms of silence.
          this.findTimeout = setTimeout(this.nextMatch.bind(this), 250);
        } else {
          this.nextMatch();
        }*/
      }.bind(this));
    },

    getMarkedContentNode: function(pointobj) {
      var page = this.pdfViewer.getPageView(pointobj.page);
      if (!page) {
        console.log('No page available with index=', pointobj.page);
        return;
      }
      if (page && page.textLayer && page.textLayer.renderingDone) {
        var divs = page.textLayer.textLayerDiv.
          querySelectorAll('*[mcid="'+pointobj.page+'/'+pointobj.mcid+'"]');
        var i = 0, div, startoffset;
        while((div = divs[i++])){
          startoffset = parseInt(div.getAttribute('startoffset'));
          if (startoffset + div.firstChild.length >= pointobj.offset) {
            pointobj.realoffset = pointobj.offset - startoffset;
            return div.firstChild;
          }
        }
      } else {
        console.warn('Page text layer is not rendered', page &&
                     page.textLayer && page.textLayer.renderingDone);
      }
    },

    _getPageBoundaryMarkedContent: function(pageindex) {
      var page = this.pdfViewer.getPageView(pageindex);
      if (!page) {
        console.log('No page available with index=', pageindex);
        return;
      }
      if (page && page.textLayer && page.textLayer.renderingDone) {
        var divs = page.textLayer.textLayerDiv.querySelectorAll('*[mcid]');
        if(divs.length){
          return [divs[0].firstChild, divs[divs.length-1].firstChild];
        }
      }
    },
    markValidationError: function(mcidString, problemType) {
      var selector = '[' + mcidString + ']';
      var elements = document.querySelectorAll(selector);
      var element = elements[0];
      if (element) {
        if (problemType === "error") {
          element.classList.add("validation-error");
        } else {
          element.classList.add("validation-warning");
        }
      }
    },
    setSelection: function(range) {
      var startcontainer = this.getMarkedContentNode(range.start);
      var originalstart = startcontainer;
      var endcontainer = this.getMarkedContentNode(range.end);
      if (!startcontainer || !endcontainer) {
        console.log('Failed to find selection in current document', range);
        return;
      }
      var sel = window.getSelection(), r;
      sel.removeAllRanges();
      while(range.start.page !== range.end.page && startcontainer){
        r = document.createRange();
        r.setStart(startcontainer, range.start.realoffset);
        var pageboundary = this._getPageBoundaryMarkedContent(range.start.page);
        if(pageboundary){
          r.setEnd(pageboundary[1], pageboundary[1].length);
        }
        sel.addRange(r);
        range.start.page += 1;
        range.start.realoffset = 0;
        startcontainer = this._getPageBoundaryMarkedContent(range.start.page);
        if(startcontainer){
          startcontainer = startcontainer[0];
        }
      }
      if(startcontainer){
        r = document.createRange();
        r.setStart(startcontainer, range.start.realoffset);
        r.setEnd(endcontainer, range.end.realoffset);
        sel.addRange(r);
      }
      var node = originalstart.nodeType !== 1 ? originalstart.parentNode :
        originalstart;
      scrollIntoView(node);
    }
  };
  return PDFHTML5Controller;
})();

function showReflow(showreflow){
  if(showreflow) {
    var iframeid = 'reflowFrame';
    var iframe = document.getElementById(iframeid);
    if(!iframe){
      iframe = document.createElement('iframe');
      iframe.src = 'reflow.html';
      iframe.setAttribute('id', iframeid);
      var style = iframe.style;
      style.width='50%';
      style.height='100%';
      style.position = 'fixed';
      style.left = "50%";
      style.top = "0";
      style.border = "none";
      style.background = "white";
      var container = document.getElementById('outerContainer');
      container.style.width='50%';
      container.parentNode.appendChild(iframe);
    }
  }
  PDFViewerApplication.pdfViewer.html5.handleEvent().then(function(html){
    if(!showreflow){
      parent.onPDFHTML(html, window);
      return;
    }
    var htmlwin = iframe.contentWindow;
      //var title = document.title+" (reflow)";
      //var htmlwin = window.open('reflow.html#', "ReflowViewer");
      var initialize = function(){
        htmlwin.document.body.innerHTML=html;
        PDFViewerApplication.pdfViewer.html_window = htmlwin;
        htmlwin.validateHTMLInReflow();
      };
      if (htmlwin.document.readyState === 'complete') {
        initialize();
      } else {
        htmlwin.onload = initialize;
      }
    });
}
/*window.addEventListener('keydown', function keydown(evt) {
  if (evt.ctrlKey && evt.keyCode === 120) { //Ctrl+F9
    showReflow();
  }
});*/
window.addEventListener('load', function(){
  var setDocument = PDFViewerApplication.pdfViewer.setDocument;
  PDFViewerApplication.pdfViewer.setDocument = function(){
    var ret = setDocument.apply(this, arguments);
    this.html5 = new PDFHTML5Controller({pdfViewer: this});
    showReflow(!parent || parent.htmlOnlyReflow);
    //setTimeout(showReflow, 0);
    //this.html5.handleEvent();
    return ret;
  };
  PDFViewerApplication.pdfViewer.setSelection = function(range){
    this.html5.setSelection(range);
  };

  PDFViewerApplication.pdfViewer.markValidationError = function(mcidString, problemType){
    this.html5.markValidationError(mcidString, problemType);
  };
});
document.addEventListener('mouseup', function(e) {
  if (!PDFViewerApplication.pdfViewer.html_window) {
    return;
  }
  var range = getMCRange();
  if (range) {
    console.log('mouseup set selection', range);
    PDFViewerApplication.pdfViewer.html_window.setSelection(range);
  }
}, false);
