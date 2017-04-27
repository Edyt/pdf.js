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

function afteronce(o, f, af) {
  var original = o[f];
  if(!original._aftered) {
    o[f] = function(){
      var ret;
      try{
        ret = original.apply(o, arguments);
        af.apply(o, arguments);
      }finally{
        o[f] = original;
      }
      return ret;
    };
    o[f].aftered = 1;
  }
};

/**
 * Provides "reflow" view for tagged PDF.
 */
var PDFHTML5Controller = (function PDFHTML5ControllerClosure() {
  function RangesCollection(){
    this._map = {};
  }
  RangesCollection.prototype = {
    add: function(range, affected) {
      if(!affected){
        affected = {};
      }
      if(range.forEach) {
        range.forEach(function(r){
          this.add(r, affected);
        }, this);
        return;
      }
      var start = range.start.page, end = range.end.page;
      while(start <= end){
        if(this._map[start]){
          this._map[start].push(range);
        } else {
          this._map[start] = [range];
        }
        affected[start] = 1;
        start++;
      }
      return affected;
    },
    remove: function(range, affected) {
      if(!affected){
        affected = {};
      }
      if(range.forEach) {
        range.forEach(function(r){
          this.remove(r, affected);
        }, this);
        return;
      }
      var start = range.start.page, end = range.end.page;
      var list, index;
      while(start <= end){
        list = this._map[start];
        if(list){
          index = list.indexOf(range);
          if(index >=0) {
            list.splice(index, 1);
          }
          affected[start] = 1;
        }
        start++;
      }
    },
    get: function(page){
      return this._map[page];
    }
  };

  function PDFHTML5Controller(options) {
    this.pdfViewer = options.pdfViewer || null;
    //console.log('this.pdfViewer', this.pdfViewer);
    this.startedTextExtraction = false;
    this.pagesPromise = this.pdfViewer.pagesPromise;
    this.highlightRanges = new RangesCollection();
    if (this.pdfViewer && this.pdfViewer.viewer) {
      var self = this;
      this.pdfViewer.viewer.addEventListener('textlayerrendered', function(e){
        if(!e.detail || !e.detail.pageNumber){
          return;
        }
        var pageindex = e.detail.pageNumber - 1;
        var scroll = false;
        if (self._lastHighlight){
          scroll = pageindex === self._lastHighlight.start.page;
        }
        self._refreshPage(pageindex, scroll);
      });
    }

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
      var element = this.pdfViewer.viewer.querySelector(selector);
      if (element) {
        if (problemType === "error") {
          element.classList.add("validation-error");
        } else {
          element.classList.add("validation-warning");
        }
      }
    },
    _makeSurePageInView: function(pageindex){
      var page = this.pdfViewer.getPageView(pageindex);
      if (!page) {
        console.log('No page available with index=', page);
        return;
      }
      if (page.renderingState !== RenderingStates.FINISHED) {
        //page not visible
        this.pdfViewer.scrollPageIntoView(pageindex+1);
        var accept, reject;
        var p = new Promise(function(a, r){
          accept = a;
          reject = r;
        });
        page.onAfterDraw = function(){
          if (page.textLayer) {
            if(!page.textLayer.textLayerRenderTask) {
              var tl = page.textLayer;
              tl._a = accept;
              tl._r = reject;
              afteronce(tl, "render", function(){
                if(this.textLayerRenderTask) {
                  this.textLayerRenderTask.promise.then(this._a).catch(this.r);
                }else{
                  this.r();
                }
              });
            } else {
              //should never happen
              //page.textLayer.textLayerRenderTask.promise.then(a).catch(r);
            }
          }
        }
        return p;
        //if(!page.div || !page.div.parentNode)debugger
      }
      if(page.textLayer){// && !page.textLayer.renderingDone) {
        return page.textLayer.textLayerRenderTask.promise;
      }
    },
    _textLayerPresent: function(pageindex) {
      var page = this.pdfViewer.getPageView(pageindex);
      if (!page) {
        console.log('_textLayerPresent: No page available with index=', page);
        return;
      }
      if (page.renderingState === RenderingStates.FINISHED) {
        return page.textLayer && page.textLayer.renderingDone;
      }
    },
    _refreshPage: function(pageindex, shouldscroll) {
      var page = this.pdfViewer.getPageView(pageindex);
      this.clearHighlight(page.textLayer.textLayerDiv);

      var ranges = this.highlightRanges.get(pageindex);
      if (!ranges) {
        return;
      }
      ranges.forEach(function(range, index){
        this._setSelectionOnPage(range, pageindex, shouldscroll && index===0);
      }, this);
    },
    setSelection: function(range) {
      //this.clearHighlight();
      var affectedpages;
      if(this._lastHighlight){
        affectedpages = this.highlightRanges.remove(this._lastHighlight);
      }
      affectedpages = this.highlightRanges.add(range, affectedpages);
      this._lastHighlight = range;
      var pagesindexes = Object.keys(affectedpages).map(function(p){return parseInt(p)});
      var focuspage = range.start.page;
      pagesindexes.forEach(function(p){
        if(this._textLayerPresent(p)){
          this._refreshPage(p, focuspage === p);
        }
      }, this);
      this.pdfViewer.scrollPageIntoView(focuspage + 1);
      return;

      var promise = this._selectPromise = this._makeSurePageInView(range.start.page);
      if (!promise){
        return;
      }
      promise.then(function(){
        if(promise === this._selectPromise){
          delete this._selectPromise;
          this._setSelection(range);
        }
      }.bind(this));
    },
    _updateRange: function(range, which, pageindex, boundary){
      if (range[which].page !== pageindex) {
        var realoffset = which === "end" ? boundary.length : 0;
        var parent = boundary.parentNode;
        var mcid = parent.getAttribute("mcid").split("/")[1];
        range[which] = {page: pageindex,
          offset: realoffset + (parseInt(parent.getAttribute("startoffset")) || 0),
          mcid: boundary.parentNode.getAttribute("mcid").split("/")[1]};
      }
    },
    _setSelectionOnPage: function(range, pageindex, trytoscroll) {
      var newrange = range;
      if(range.start.page !== pageindex || range.end.page !== pageindex) {
        newrange = Object.create(range);
        var pageboundary = this._getPageBoundaryMarkedContent(pageindex);
        this._updateRange(newrange, "start", pageindex, pageboundary[0]);
        this._updateRange(newrange, "end", pageindex, pageboundary[1]);
      }
      this._setSelection(newrange, trytoscroll);
    },
    _setSelection: function(range, tryToScroll) {
      var startcontainer = this.getMarkedContentNode(range.start);
      var originalstart = startcontainer;
      var endcontainer = this.getMarkedContentNode(range.end);
      var r, needscroll, currentneedscroll;
      if (!startcontainer || !endcontainer) {
        console.log('Failed to find selection in current document', range);
        return;
      }
      //var sel = window.getSelection(), r;
      //sel.removeAllRanges();
      while(range.start.page !== range.end.page && startcontainer){
        r = document.createRange();
        r.setStart(startcontainer, range.start.realoffset);
        var pageboundary = this._getPageBoundaryMarkedContent(range.start.page);
        if(pageboundary){
          r.setEnd(pageboundary[1], pageboundary[1].length);
        }
        //sel.addRange(r);
        currentneedscroll = this._highlight(r);
        if (needscroll == undefined){
          needscroll = currentneedscroll;
        }
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
        //sel.addRange(r);
        currentneedscroll = this._highlight(r);
        if (needscroll === undefined){
          needscroll = currentneedscroll;
        }
      }
      if(needscroll && tryToScroll){
        var node = originalstart.nodeType !== 1 ? originalstart.parentNode :
          originalstart;
        scrollIntoView(node);
      }
    },
    _highlight: function(range) {
      var textlayerdiv = range.startContainer.parentNode.offsetParent;
      var pagerect = textlayerdiv.getBoundingClientRect();
      var rect, elem, i = 0, style;
      var rects = this._getClientRects(range); //range.getClientRects();
      var template = document.createElement('div');
      template.className ='alignedSelection';
      var viewportHeight = document.body.scrollHeight;
      var needscroll;
      while(rect = rects[i++]){
        elem = template.cloneNode(false);
        style = elem.style;
        style.top = Math.round(rect.top - pagerect.top) + 'px';
        style.left = Math.round(rect.left - pagerect.left) + 'px';
        style.width = Math.round(rect.width) + 'px';
        style.height = Math.round(rect.height) + 'px';
        textlayerdiv.appendChild(elem);
        if (i===1) {
          needscroll = rect.top < 25 || rect.top > viewportHeight - 25;
        }
      }
      return needscroll;
    },
    _firstParentWithoutMCID: function(node){
      while (node.nodeType !== 1 || node.getAttribute('mcid')){
        node = node.parentNode;
      }
      return node;
    },
    _nextElement: function(start, end) {
      var cur = start, next;
      while(!cur.nextSibling) {
        cur = cur.parentNode;
      }
      next = cur.nextSibling;
      while (next && next !== end && next.contains(end)) {
        next = next.firstChild;
      }
      return next;
    },
    _getClientRects: function(range) {
      //only mcid spans have absolute positioning and sizing, while their
      //structural parent (like paragraph) does not, so any rects returned by
      //range on a block level elements are wrong. find the block level
      //elements and use the union of all children mcid spans to figure out the
      //size
      var startParent = this._firstParentWithoutMCID(range.startContainer);
      var endParent = this._firstParentWithoutMCID(range.endContainer);
      var spans, clone, spantext;
      var results = [];
      function collectRects(rects){
        results = results.concat([].slice.apply(rects));
      }
      if (startParent !== endParent) {
        spans = startParent.querySelectorAll("[mcid]");

        clone = range.cloneRange();
        spantext = spans[spans.length-1].firstChild;
        clone.setEnd(spantext, spantext.length);
        collectRects(clone.getClientRects());
        startParent = this._nextElement(startParent, endParent);
        while(true){
          if (startParent && startParent !== endParent){
            spans = startParent.querySelectorAll("[mcid]");
            [].slice.apply(spans).forEach(function(s){
              collectRects(s.getClientRects());
            });
            startParent = this._nextElement(startParent, endParent);
          } else {
            startParent = endParent;
            range.setStart(startParent, 0);
            break;
          }
        }
      }
      collectRects(range.getClientRects());
      return results;
    },
    clearHighlight: function(root) {
      root = root || this.pdfViewer.viewer;
      var highlights = root.querySelectorAll(".alignedSelection");
      [].slice.apply(highlights).forEach(function(e){
        e.parentNode.removeChild(e);
      });
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
window.addEventListener('DOMContentLoaded', function(){
  afteronce(PDFViewerApplication, "initialize", function(){
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
}, true);

document.addEventListener('mouseup', function(e) {
  PDFViewerApplication.pdfViewer.html5.clearHighlight();
  if (!PDFViewerApplication.pdfViewer.html_window) {
    return;
  }
  var range = getMCRange();
  if (range) {
    console.log('mouseup set selection', range);
    PDFViewerApplication.pdfViewer.html_window.setSelection(range);
  }
}, false);
