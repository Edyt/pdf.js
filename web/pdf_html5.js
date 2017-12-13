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
        return affected;
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
        return affected;
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
      return affected;
    },
    clear: function(affected) {
      if(!affected){
        affected = {};
      }
      Object.keys(this._map).forEach(function(k){ affected[k] = 1 });
      this._map = {};
      return affected;
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
          scroll = pageindex === (self._lastHighlight[0] || self._lastHighlight).start.page;
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

  /*var getFontSize = function(tm){
    return Math.round(Math.sqrt(tm[2]*tm[2] + tm[3]*tm[3]));
  };*/

  var within = function(d, l, r){
    return l < d && d < r;
  };
  var checkShift = function(last, item) {
    var tm = item.transform;
    var left = tm[4], top = -tm[5];
    var fs = item.height;//getFontSize(tm);
    var result = null;
    if(last.top < 0){
      if(last.sub && last.sub.top === top){
        result = 'sub';
      } else if(last.sup && last.sup.top === top) {
        result = 'sup';
      } else if(within(left, last.left, last.left + fs)) {
        if (within(last.top, top, top + fs)) {
          result = 'sup';
        } else if (within(top+fs, last.top, last.top+last.height)) {
          result = 'sub';
        }
      } else {
        last.sub = last.sup = null;
      }
    }
    if(result){
      last[result] = {top: top};//, height: item.height};
    } else {
      last.top = top;
      last.height = fs;
    }
    last.left = left + item.width;
    //last.shift = result;
    return result;
  };

  var createMCID = function(mcid, textchunks, lastPos) {
    var frag = document.createDocumentFragment();
    var i = 0, chunk, elem, offset = 0;
    var styles, checkstyle;
    while(chunk = textchunks[i++]){
      elem = document.createElement('span');
      elem.setAttribute('MCID', mcid);
      if(offset){
        elem.setAttribute('startoffset', offset);
      }
      elem.textContent = chunk.str;
      offset += chunk.str.length;
      styles = [];
      //console.log(mcid, lastPos);
      checkstyle = checkShift(lastPos, chunk);
      if(checkstyle){
        styles.push(checkstyle);
      }
      if(styles.length){
        styles.forEach(function(nodeName){
          var newelem = document.createElement(nodeName);
          newelem.appendChild(elem);
          elem = newelem;
        });
      }
      frag.appendChild(elem);
    }
    return frag;
  };

  var getChunkStyles = function(fontStyle, lastchunk, fontsize, top){
    var r = [];
    if(fontStyle.bold){
      r.push('b');
    }
    if(fontStyle.italic){
      r.push('i');
    }
    if(lastchunk && lastchunk.fs > fontsize){
      r.push(top > lastchunk.top ? 'sub' : 'sup');
    }
    return r.length ? r : null;
  };

  var IMAGE_SCALE = 1.5;
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
            var item, mcid, fontsize, mseqs;
            for (var i = 0, len = textItems.length; i < len; i++) {
              item = textItems[i];
              if (item && item.markedContent) {
                mcid = item.markedContent.MCID;
                mseqs = markedSeqs[mcid] || (markedSeqs[mcid] = []);
                mseqs.push(item);
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
                var elements = {}, parent, current, seqs, elementname, elem, pdfid;
                var promise = Promise.resolve();
                var svgFigures = {};
                var svgPages = {};
                var lastelem;
                var lastPos = {top: 1}; //needs to be positive
                while(queue.length){
                  current = queue.shift();
                  parent = elements[current.parentpdfid] || top;
                  pdfid = current.pdfid;
                  if (current.type === 'StructElem' ){
                    children = current.children;
                    if(children && children.length === 1 && children[0].type === 'MCR'){
                      seqs = self.pageMarkedSequences[current.page];
                      seqs = seqs && seqs[children[0].MCID];
                      if(seqs && seqs[0].eolHyphen){
                        continue;
                      }
                    }

                    elementname = roleMap[current.name] || current.name;
                    if (elementname === 'Link') {
                      elementname = 'a';
                    } else if (elementname === 'Document') {
                      elementname = 'div';
                    }
                    if (elementname.toLowerCase() === 'table') {
                      lastelem = parent.firstChild;
                      if (lastelem && lastelem.nodeName.toLowerCase() === 'table'){
                        if(children && children[0].children && lastelem.rows.length){
                          if(children[0].children.length === lastelem.rows[0].cells.length){
                            elements[pdfid] = lastelem;
                            queue = current.children.concat(queue);
                            continue;
                          }
                        }
                      }
                    }
                    elements[pdfid] = elem =
                      parent.appendChild(document.createElement(elementname));

                    //add non-versioned pdfid to the elements dict
                    if (pdfid.charAt(pdfid.length - 1) !== 'R'){
                      elements[pdfid.split('R')[0] + 'R'] = elem;
                    }
                    elem.setAttribute('pdfid', pdfid);
                    if (elementname === 'a' && current.uri) {
                      elem.setAttribute('href', current.uri);
                    }
                    if (elementname === 'Figure') {
                      if(!isNaN(current.page)){
                        svgFigures[pdfid] = elem;
                        if(!svgPages[current.page]){
                          svgPages[current.page] = 1;
                          promise = promise.then((function(pageindex){
                              return function(){
                                return self.pdfViewer.pdfDocument.getPage(pageindex + 1);
                              };
                          })(current.page)).then(function (page) {
                              var viewport = page.getViewport(IMAGE_SCALE);
                              return page.getOperatorList(true).then(function (opList) {
                                var svgGfx = new PDFJS.SVGGraphics(page.commonObjs, page.objs, page.pageIndex);
                                return svgGfx.getSVG(opList, viewport);
                              });
                          }).then(function (images) {
                            var pdfid;
                            var fig, parent;
                            for(pdfid in images){
                              if(fig = svgFigures[pdfid]){
                                parent = fig.parentNode;
                                parent.replaceChild(images[pdfid], fig);
                              } else {
                                console.warn('missing figure in generated output', pdfid);
                              }
                            }
                          });
                        }
                      }
                    } else if (children) {
                      queue = current.children.concat(queue);
                    }
                  } else if (current.type === 'MCR') {
                    //marked content sequence
                    seqs = self.pageMarkedSequences[current.page];
                    if (seqs && seqs[current.MCID]) {
                      parent.appendChild(
                        createMCID(current.page + '/' + current.MCID,
                        seqs[current.MCID], lastPos));
                    }
                  }
                }
                promise.then(function(){
                  self._resolve(top.innerHTML);
                  self.startedTextExtraction = false;
                });
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
    setSelection: function(range, type) {
      //this.clearHighlight();
      var firstrange = range[0] || range;
      var affectedpages;
      if(type === 'align'){
        if(this._lastHighlight){
          affectedpages = this.highlightRanges.remove(this._lastHighlight, affectedpages);
        }
      } else {
        affectedpages = this.highlightRanges.clear(affectedpages);
        if(this._lastHighlight){
          affectedpages = this.highlightRanges.add(this._lastHighlight, affectedpages);
        }
      }

      affectedpages = this.highlightRanges.add(range, affectedpages);

      if(type){
        this._lastHighlight = range;
      }
      var pagesindexes = Object.keys(affectedpages).map(function(p){return parseInt(p)});
      var focuspage = type === 'align' && firstrange && firstrange.start.page;
      pagesindexes.forEach(function(p){
        if(this._textLayerPresent(p)){
          console.log('refreshing already renderred pages', p);
          this._refreshPage(p, focuspage === p);
        }
      }, this);
      if(firstrange){
        this.pdfViewer.scrollPageIntoView(focuspage + 1);
      }
      return;

      var promise = this._selectPromise = this._makeSurePageInView(focuspage);
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
      var className = range.type==="align" ? "alignedSelection" : range.type;

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
        currentneedscroll = this._highlight(r, className);
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
        currentneedscroll = this._highlight(r, className);
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
    _highlight: function(range, className) {
      var textlayerdiv = range.startContainer.parentNode.offsetParent;
      var pagerect = textlayerdiv.getBoundingClientRect();
      var rect, elem, i = 0, style;
      var rects = this._getClientRects(range); //range.getClientRects();
      var template = document.createElement('div');
      template.className = className;//'alignedSelection';
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
    clearHighlight: function(root, cssquery) {
      console.log('clearHighlight:', root && root.parentNode);
      root = root || this.pdfViewer.viewer;
      var highlights = root.querySelectorAll(cssquery || '.alignedSelection, .validation-warning, .validation-error');
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
      if(parent.onPDFHTML){
        parent.onPDFHTML(html, window);
      }
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
    PDFViewerApplication.pdfViewer.setSelection = function(range, type){
      this.html5.setSelection(range, type);
    };

    PDFViewerApplication.pdfViewer.markValidationError = function(mcidString, problemType){
      this.html5.markValidationError(mcidString, problemType);
    };
  });
}, true);

document.addEventListener('mouseup', function(e) {
  //only clear out aligned format highlighting
  PDFViewerApplication.pdfViewer.html5.clearHighlight(null, '.alignedSelection');
  if (!PDFViewerApplication.pdfViewer.html_window) {
    return;
  }
  var range = getMCRange(true);
  if (range) {
    console.log('mouseup set selection', range);
    PDFViewerApplication.pdfViewer.html_window.setSelection(range);
  }
}, false);
