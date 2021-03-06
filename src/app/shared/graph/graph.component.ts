import {
	Component,
	OnInit,
	OnChanges,
	ViewChild,
	ElementRef,
	Input,
	ViewEncapsulation
} from '@angular/core';
import * as d3 from 'd3';

@Component({
	selector: 'app-graph',
	templateUrl: 'graph.component.html',
	styleUrls: ['graph.component.scss']
	 /*styles: [`
    .noselect {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    -khtml-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none;
	}
  `]*/
})

export class GraphComponent implements OnInit {

	@Input() private data: Array < any > ;
	@ViewChild('graph') private graphContainer: ElementRef;
	//private margin: any = { top: 20, bottom: 20, left: 20, right: 20};
	private nodeRadius: number;
	private colors: string;
	private strokeThickness: number;
	private edgeThickness: number;
	private nodeSpacing: number;
	//dictionary of 'name' : 'svg parent' for easy node access
	private nodeDict: any = {};
	//dictionary of 'name' : 'list of connected edges' for easy edge access
	private edgeDict: any = {};
	//list of lists, where each list contains the order in which nodes appear in the column corresponding to the list #
	private columnList : any = [];

	//mouse drag vars
	private startCoords: [number,number];
	private dragging: boolean = false;
	private dragNode: any;

	private nodeFontSize : number;
	private graph: any;
	private nodeParent : any;
	private edgeParent : any;

	constructor() {

	}

	ngOnInit() {
		this.initConstants();
		this.createGraph();
		if (this.data) {
			this.updateGraph();
		}
	}

	ngOnChanges() {
		if (this.graph) {
			this.updateGraph();
		}
	}

	/*initialize constant instance variables here*/
	initConstants() {
		this.nodeRadius = 30;
		this.strokeThickness = 2;
		this.edgeThickness = 2;
		this.nodeSpacing = 12;
		this.nodeFontSize = 12;
	}

	/*create the main graph svg and load in the course data*/
	createGraph() {
		//maintain a reference to this in case we need to access it while inside a selection
		let baseThis = this;

		//construct graph
		this.graph = d3.select(this.graphContainer.nativeElement).append('svg')
			.attr("width","100%")
			.attr("height","2500")
			/*.attr("height","600")*/

		//construct edge and node group parents
		this.edgeParent = this.graph.append("g").attr("id","edges");
		this.nodeParent = this.graph.append("g").attr("id","nodes");

		//setup mouse events on graph
		this.graph.on("mousedown", function() {
			//poll for closest node on mouseDown
			baseThis.startCoords = d3.mouse(this);
			let closestNode = null;
			let closestDistance = -1;
			for (let nodeKey in baseThis.nodeDict) {
				let curCircle = baseThis.nodeDict[nodeKey];
				//distance formula
				let curDistance = Math.sqrt(
					Math.pow(+curCircle.attr("x") + +curCircle.attr("width") / 2 - baseThis.startCoords[0], 2) +
					Math.pow(+curCircle.attr("y") + +curCircle.attr("height") / 2 - baseThis.startCoords[1], 2));
				if (closestDistance == -1 || curDistance < closestDistance) {
					closestDistance = curDistance;
					closestNode = baseThis.nodeDict[nodeKey];
				}
			}

			//check if closest node is within drag start distance
			if (closestDistance <= baseThis.nodeRadius && closestDistance != -1) {
				baseThis.dragging = true;
				baseThis.dragNode = closestNode;
			}
			
		})
		//optional: stop dragging on mouse leave. Depends on preference.
		/*.on("mouseleave", function() {
			baseThis.dragging = false;
		})*/

		.on("mousemove", function() {
			//check for node dragging
			if (baseThis.dragging) {
				let coords = d3.mouse(this);
	            let dx = (coords[0] - baseThis.startCoords[0]);
	            let dy = (coords[1] - baseThis.startCoords[1]);
	            //note the use of the unary operator '+' to convert string attr to int (the first '+' is NOT a concatenation)
	            baseThis.dragNode.attr("x", +baseThis.dragNode.attr("x") + dx);
	        	baseThis.dragNode.attr("y", +baseThis.dragNode.attr("y") + dy);

	        	baseThis.fixEdges(baseThis.dragNode.attr("id"));
	        	baseThis.startCoords[0] += dx;
		        baseThis.startCoords[1] += dy;
			}
		})

		.on("mouseup", function() {
			baseThis.dragging = false;
		});
		
		this.loadGraphData();
	}

	/*load in graph data from prereq file (hosted by data service)*/
	loadGraphData() {
		let baseThis = this;
		d3.json("http://localhost:3100/prereq/CSCI", function(prereqs) {
			let nodeData = prereqs["CSCI_nodes"];
			let metaNodeData = prereqs["meta_nodes"];

			//first construct meta-nodes as standard nodes depend on their existence for edge creation
			for (let metaNode of metaNodeData) {
				let circle = baseThis.constructNode(metaNode.meta_uid,metaNode.contains);
			}

			//construct graph nodes
			for (let node of nodeData) {
				let circle = baseThis.constructNode(node.course_uid,null);

				//construct edges based off of this node's prereqs and coreqs
				let hasValidEdge = false;
				for (let edge of node.prereq_formula) {
					hasValidEdge = baseThis.constructEdge(circle,baseThis.nodeDict[edge],"prereq") || hasValidEdge;
				}
				for (let edge of node.coreq_formula) {
					baseThis.constructEdge(circle,baseThis.nodeDict[edge],"coreq");
				}
				//start at column 0 if we have no prereqs or our prereqs are not in the dataset
				if (node.prereq_formula.length == 0 || !hasValidEdge) {
					baseThis.setColNum(circle,0);
				}
			}

			//layout standard nodes and edges
			baseThis.layoutColumns();


		});
	}

	/*recalculate all edges connected to node id*/
	fixEdges(nodeID : string) {
		let connectedEdges = this.edgeDict[nodeID];
    	if (connectedEdges) {
    		for (let curEdge of connectedEdges) {
    			this.recalculateEdge(curEdge);
    		}
    	}
	}

	/*organize nodes into columns based on their prereqs*/
	layoutColumns() {
		//start by laying out nodes branching from first column (nodes with no dependencies)
		for (let node of this.columnList[0]) {
			this.layoutFromNode(node,0);			
		}

		//move meta nodes to the same column as their farthest contained node, and stick 6000+ level classes at the end
		for (let key in this.nodeDict) {
			let curNode = this.nodeDict[key];
			if (curNode.containedNodeIds != null) {
				let farthestColumn = 0;
				for (let i = 0; i < curNode.containedNodeIds.length; ++i) {
					let curContainedNode = this.nodeDict[curNode.containedNodeIds[i]];
					farthestColumn = Math.max(farthestColumn,curContainedNode? +curContainedNode.attr("column") : 0);
				}
				this.layoutFromNode(curNode,farthestColumn);
			}
			else if (+curNode.attr("id")[5] >= 6) {
				this.setColNum(curNode,this.columnList.length-1,true);
			}
		}
	}

	/*layout nodes stemming from current node*/
	layoutFromNode(node : any, colNum : number) {
		if (+node.attr("column") != colNum) {
			this.setColNum(node,colNum);
		}
		if (this.edgeDict[node.attr("id")]) {
			for (let edge of this.edgeDict[node.attr("id")]) {
				if (edge.attr("endNodeID") == node.attr("id")) {
					this.layoutFromNode(this.nodeDict[edge.attr("startNodeID")],colNum+1);
					this.recalculateEdge(edge);
				}
			}
		}
		
	}

	/*move Node node to column colNum*/
	setColNum(node : any, colNum: number, allowColumnChange = false) {
		if (colNum == node.attr("column")) {
			return;
		}
		if (+node.attr("column") == -1 || allowColumnChange) {
			//make sure we have enough columns
			while (this.columnList.length < (colNum+1)) {
				this.columnList.push([]);
			}
			if (+node.attr("column") != -1) {
				//remove from current column
				let oldColumn = this.columnList[+node.attr("column")];
				let oldIndex = oldColumn.indexOf(node);
				oldColumn.splice(oldIndex,1);
				//reposition displaced nodes
				for (let i = oldIndex; i <oldColumn.length; ++i) {
					
					this.repositionNode(+node.attr("column"),i);
				}
			}
			
			//add to new column
			this.columnList[colNum].push(node);
			this.repositionNode(colNum,this.columnList[colNum].length-1);

		}
	}

	/*reposition node at position colNum[index]*/
	repositionNode(colNum : number, index : number) {
		let node = this.columnList[colNum][index];
		node.attr("column",colNum);
		node.attr("x",this.nodeSpacing + ((this.nodeRadius + this.strokeThickness) * 2 + this.nodeSpacing) * colNum);
		node.attr("y",this.nodeSpacing + ((this.nodeRadius + this.strokeThickness) * 2 + this.nodeSpacing) * (index));
		this.fixEdges(node.attr("id"));
	}

	/*construct a new node from a course uid*/
	constructNode(cuid : string, containedNodeIds : string[]) {
		//node parent
		let circle = this.nodeParent.append("svg")
			.attr("column",-1)
			.attr("width", this.nodeRadius * 2 + this.strokeThickness * 2)
			.attr("height", this.nodeRadius * 2 + this.strokeThickness * 2)
			.attr("isDown",true)
			.attr("id",cuid)  
		circle.containedNodeIds = containedNodeIds;

		//node circle element
		let circleGraphic = circle.append("circle")
			.attr("cx", this.nodeRadius + this.strokeThickness)
			.attr("cy", this.nodeRadius + this.strokeThickness)
			.attr("r", this.nodeRadius)
			.attr("stroke", "black")
			.attr("stroke-width", this.strokeThickness)
			.attr("fill", "rgb(200,200,255)");

		//node text element
		let circleText = circle.append("text")
			.classed('noselect', true)
			.attr("x", this.nodeRadius + this.strokeThickness)
			.attr("y", this.nodeRadius + this.strokeThickness)
			.attr("font-size", this.nodeFontSize + "px")
			.attr("text-anchor", "middle")
			.attr("alignment-baseline", "central")
			.text(cuid);
			

		this.nodeDict[cuid] = circle;
		return circle;
	}

	/*construct a new edge from start and end node, if they exist*/
	constructEdge(startNode : any, endNode : any, type : string) {
		if (! (startNode && endNode)) {
			return false;
		}

		let startNodeX = +startNode.attr("x") + +startNode.attr("width") /2;
		let startNodeY = +startNode.attr("y") + +startNode.attr("height") /2;
		let endNodeX = +endNode.attr("x") + +endNode.attr("width") /2;
		let endNodeY = +endNode.attr("y") + +endNode.attr("height") /2;
		
		let edgeWidth = Math.abs(startNodeX - endNodeX);
		let edgeHeight = Math.abs(startNodeY - endNodeY);
		
		//edge parent
		let newEdge = this.edgeParent.append("svg")
		.attr("startNodeID", startNode.attr("id"))
		.attr("endNodeID", endNode.attr("id"));

		//edge line element
		let edgeGraphic = newEdge.append("line")
		.attr("stroke-width",this.edgeThickness)
		.attr("stroke", type == "prereq" ? "red" : "green");

		if (!this.edgeDict[startNode.attr("id")]) {
			this.edgeDict[startNode.attr("id")] = [];
		}
		this.edgeDict[startNode.attr("id")].push(newEdge);
		if (!this.edgeDict[endNode.attr("id")]) {
			this.edgeDict[endNode.attr("id")] = [];
		}
		this.edgeDict[endNode.attr("id")].push(newEdge);

		this.recalculateEdge(newEdge);
		return true;
	}

	/*recalculate position, dimensions, and line position of connectedEdge*/
	recalculateEdge (connectedEdge : any) {
		let edgeLine = connectedEdge.select("line");

		let startNode = this.nodeDict[connectedEdge.attr("startNodeID")];
		let endNode = this.nodeDict[connectedEdge.attr("endNodeID")];

		let startNodeX = +startNode.attr("x") + +startNode.attr("width") /2;
		let startNodeY = +startNode.attr("y") + +startNode.attr("height") /2;
		let endNodeX = +endNode.attr("x") + +endNode.attr("width") /2;
		let endNodeY = +endNode.attr("y") + +endNode.attr("height") /2;

		let minX = Math.min(startNodeX,endNodeX);
		let maxX = Math.max(startNodeX,endNodeX);
		let minY = Math.min(startNodeY,endNodeY);
		let maxY = Math.max(startNodeY,endNodeY);

		let edgeWidth = maxX - minX;
		let edgeHeight = maxY - minY;

		connectedEdge.attr("width", edgeWidth + this.edgeThickness);
		connectedEdge.attr("height", edgeHeight + this.edgeThickness);

		connectedEdge.attr("x", minX - this.edgeThickness/2);
		connectedEdge.attr("y", minY - this.edgeThickness/2);

		if (minX == startNodeX) {
			edgeLine.attr("x1", this.edgeThickness / 2);
			edgeLine.attr("x2", edgeWidth + this.edgeThickness / 2)
		}
		else {
			edgeLine.attr("x1",edgeWidth + this.edgeThickness / 2)
			edgeLine.attr("x2", this.edgeThickness / 2);
		}
		if (minY == startNodeY) {
			edgeLine.attr("y1", this.edgeThickness / 2);
			edgeLine.attr("y2",edgeHeight + this.edgeThickness / 2)
		}
		else {
			edgeLine.attr("y1",edgeHeight + this.edgeThickness/ 2)
			edgeLine.attr("y2", this.edgeThickness / 2);
		}
	}

	updateGraph() {
		/*
		let update = this.graph.selectAll('.bar')
			.data(this.data);

		// remove exiting bars
		update.exit().remove();

		// update existing bars
		this.graph.selectAll('.bar').transition()
			.attr('x', d => 20
			.attr('y', d => 30
			.attr('width', d => this.nodeRadius
			.attr('height', d => this.nodeRadius
			.style('fill', (d, i) => this.colors(i));

		// add new bars
		update
			.enter()
			.append('rect')
			.attr('class', 'bar')
			.attr('x', d => 20
			.attr('y', d => 30
			.attr('width', this.nodeRadius
			.attr('height', 0)
			.style('fill', (d, i) => this.colors(i))
			.transition()
			.delay((d, i) => i * 10)
			.attr('y', d => 30);
			.attr('height', d => this.nodeRadius);
		*/
	}
}